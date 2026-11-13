import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  joinAccountRoom, getRoomMessages, getOlderRoomMessages, sendRoomMessage, heartbeatParticipant,
  getStreamAccountRoomEventsUrl, getGetMyProfileQueryKey, getGetChatAccessQueryKey,
  type RoomState, type ChatMessage, type ChatAccepted,
} from "@workspace/api-client-react";
import { saveCreds, type RoomCreds } from "@/lib/room-creds";
import { errStatus, errMessage } from "@/lib/errors";

const messageError = (error: unknown) => {
  const message = errMessage(error, "Room request failed");
  if ((errStatus(error) ?? 0) >= 500 || /internal server error/i.test(message)) {
    return "Room chat is reconnecting. Please keep this page open.";
  }
  return message;
};
const ordered = (messages: ChatMessage[]) => [...new Map(messages.map(m => [m.id, m])).values()]
  .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));

export type RoomCoinDropEvent = {
  eventId: string;
  roomId: string;
  amount: number;
  startedAt: number;
  qualified: boolean;
};
export type RoomHangoutStreakRewardEvent = { day: string; coins: number };

/** Reuses the authenticated chat SSE and private membership header. No media SDK. */
export function useTextRoom(roomId: string, userId: string) {
  const qc = useQueryClient();
  const roomEntryId = useMemo(() => typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`, [roomId, userId]);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [arrivals, setArrivals] = useState<{ id: string; participantId: string; displayName: string; at: number }[]>([]);
  const [coinDrops, setCoinDrops] = useState<RoomCoinDropEvent[]>([]);
  const [streakReward, setStreakReward] = useState<RoomHangoutStreakRewardEvent | null>(null);
  const [creds, setCreds] = useState<RoomCreds | null>(null);
  const credential = useRef<RoomCreds | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [connection, setConnection] = useState("Connecting…");
  const [error, setError] = useState<string | null>(null);
  const [roomUnavailable, setRoomUnavailable] = useState(false);
  const [overflow, setOverflow] = useState<{ roomId: string; label: string } | null>(null);
  const refreshAction = useRef<() => Promise<void>>(async () => {});
  const alive = useRef(false);

  const refresh = useCallback(async () => refreshAction.current(), []);
  const loadOlder = useCallback(async () => {
    const c = credential.current;
    const first = messages[0];
    if (!c || !first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const older = await getOlderRoomMessages(roomId, first.id, { headers: { "X-Room-Session": c.participantSessionId } });
      if (alive.current) {
        setMessages(previous => ordered([...older, ...previous])); setHasOlder(older.length === 60);
      }
    } catch (e) { if (alive.current) setError(messageError(e)); }
    finally { if (alive.current) setLoadingOlder(false); }
  }, [roomId, messages, loadingOlder]);
  const send = useCallback(async (text: string, kind: "text" | "reaction" = "text"): Promise<ChatAccepted> => {
    const c = credential.current;
    if (!c || !alive.current) throw new Error("Wait for your room connection");
    const accepted = await sendRoomMessage(roomId, { text, kind }, {
      headers: { "X-Room-Session": c.participantSessionId },
    });
    if (alive.current) {
      setMessages(previous => ordered([...previous, accepted.message]));
      void qc.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
    }
    return accepted;
  }, [roomId, qc]);

  useEffect(() => {
    let active = true;
    alive.current = true;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let joining = false;
    let knownParticipantIds: Set<string> | null = null;
    const headers = () => ({ "X-Room-Session": credential.current!.participantSessionId });
    setRoom(null); setMessages([]); setArrivals([]); setEntranceEffects([]); setCoinDrops([]); setStreakReward(null); setLoading(true); setError(null);
    setRoomUnavailable(false); setOverflow(null);
    credential.current = null; setCreds(null);

    async function history(replace = true) {
      if (!credential.current) return;
      const incoming = await getRoomMessages(roomId, { headers: headers(), signal: controller.signal });
      if (active) {
        setMessages(previous => replace ? incoming : ordered([...previous, ...incoming]));
        setHasOlder(incoming.length === 60);
        setLoading(false);
      }
    }
    async function join() {
      if (joining || !active) return;
      joining = true;
      try {
        const session = await joinAccountRoom(roomId, {
          signal: controller.signal,
          headers: { "X-Room-Entry-Id": roomEntryId },
        });
        if (!active) return;
        const c = { participantSessionId: session.participantSessionId, participantId: session.participantId };
        credential.current = c; setCreds(c); saveCreds(userId, roomId, c);
        knownParticipantIds = new Set(session.room.participants.map(participant => participant.participantId));
        const self = session.room.participants.find(participant => participant.participantId === session.participantId);
        if (self) setArrivals(previous => [...previous, {
          id: `arrival-${self.participantId}-${self.joinedAt}`,
          participantId: self.participantId,
          displayName: self.displayName,
          at: new Date(self.joinedAt).getTime(),
        }].slice(-100));
        setRoom(session.room);
      } finally { joining = false; }
    }
    refreshAction.current = async () => {
      try { if (!credential.current) await join(); await history(); setError(null); }
      catch (e) { if (active) setError(messageError(e)); }
    };
    async function connect() {
      try {
        await join();
        if (!active || !credential.current) return;
        const response = await fetch(getStreamAccountRoomEventsUrl(roomId), {
          credentials: "same-origin", headers: headers(), signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error("Could not connect to room chat");
        // Subscribe before fetching history, then consume buffered events:
        // messages committed between those operations cannot be lost.
        await history();
        if (!active) return;
        setConnection("Connected"); setError(null);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (active) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            const type = /^event: (.+)$/m.exec(frame)?.[1];
            const data = /^data: (.+)$/m.exec(frame)?.[1];
            if (!data || !active) continue;
            if (type === "room.expired") {
              active = false;
              controller.abort();
              setRoomUnavailable(true);
              setConnection("Not connected");
              return;
            }
            if (type === "room.kicked") {
              const kick = JSON.parse(data) as { message?: unknown };
              active = false;
              controller.abort();
              setLoading(false);
              setConnection("Not connected");
              setError(kick.message === "You've been removed from the room"
                ? kick.message : "You've been removed from the room");
              return;
            }
            if (type === "room.snapshot") {
              const snapshot = JSON.parse(data) as RoomState;
              const nextIds = new Set(snapshot.participants.map(participant => participant.participantId));
              if (knownParticipantIds) {
                const entered = snapshot.participants.filter(participant => !knownParticipantIds!.has(participant.participantId));
                if (entered.length) setArrivals(previous => [...previous, ...entered.map(participant => ({
                  id: `arrival-${participant.participantId}-${participant.joinedAt}`,
                  participantId: participant.participantId,
                  displayName: participant.displayName,
                  at: new Date(participant.joinedAt).getTime(),
                }))].slice(-100));
              }
              knownParticipantIds = nextIds;
              setRoom(snapshot);
            }
            if (type === "chat.accepted") {
              const accepted = JSON.parse(data) as ChatAccepted;
              setMessages(previous => ordered([...previous, accepted.message]));
            }
            if (type === "chat.refresh") await history();
            if (type === "room.coin-drop") {
              const event = JSON.parse(data) as RoomCoinDropEvent;
              if (event.roomId === roomId) {
                setCoinDrops(previous => previous.some(item => item.eventId === event.eventId)
                  ? previous : [...previous, event].slice(-20));
                void qc.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
              }
            }
            if (type === "room.hangout-streak-reward") {
              const event = JSON.parse(data) as RoomHangoutStreakRewardEvent;
              setStreakReward(event);
              void qc.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
              window.setTimeout(() => setStreakReward(current => current?.day === event.day ? null : current), 6500);
            }
          }
        }
        if (active) throw new Error("Connection interrupted; reconnecting…");
      } catch (e) {
        if (!active) return;
        const status = errStatus(e);
        if (status === 404 || status === 410) {
          setRoomUnavailable(true);
          setLoading(false);
          setConnection("Not connected");
          setError(null);
          return;
        }
        const offer = (e as { data?: { overflow?: { roomId: string; label: string } } })?.data?.overflow;
        if (offer) setOverflow(offer);
        setError(messageError(e)); setLoading(false);
        if (status === 403) void qc.invalidateQueries({ queryKey: getGetChatAccessQueryKey() });
        if (status && status >= 400 && status < 500 && status !== 429) {
          setConnection("Not connected"); return;
        }
        setConnection("Reconnecting…"); retry = setTimeout(connect, 3000);
      }
    }
    heartbeat = setInterval(() => {
      const c = credential.current;
      if (!active || !c) return;
      void heartbeatParticipant(roomId, c.participantSessionId, { signal: controller.signal })
        .catch(() => { if (active) setConnection("Reconnecting…"); });
    }, 25_000);
    void connect();
    return () => {
      active = false; alive.current = false; controller.abort();
      clearInterval(heartbeat); if (retry) clearTimeout(retry);
      // Do not revoke another tab's shared account membership. Presence expires
      // via the existing heartbeat lease; persisted history/membership remains.
    };
  }, [roomId, userId]);
  return { room, messages, arrivals, coinDrops, streakReward, creds, loading, connection, error, roomUnavailable,
    overflow, send, refresh, loadOlder, loadingOlder, hasOlder };
}
