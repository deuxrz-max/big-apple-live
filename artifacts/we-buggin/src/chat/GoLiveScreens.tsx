import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Crown, Eye, Flag, FlipHorizontal, Mic, MicOff, Radio, Send, Share2, Swords, Users, Video, X } from "lucide-react";
import { Link, useLocation } from "wouter";
import { ScreenHeader } from '@/components/app-chrome';
import { type RemoteTrack } from "livekit-client";
import {
  getGetPkBattleStateQueryKey, getGetRoomQueryKey, getGetSocialBlocksQueryKey, getGetSocialMeQueryKey, getGetSocialPersonQueryKey,
  addLiveStreamShare, getLiveStreams, searchPkOpponent, cancelPkOpponentSearch, sendLiveStreamChatMessage, useGetPkBattleState, useGetSocialBlocks, useGetSocialMe,
  useCreateAccountRoom, useCreateChessRoom, useGetSocialPerson, useSetSocialRelationship,
} from "@workspace/api-client-react";
import type { LiveStreamEntry, LiveStreamChatMessage, LiveStreamEngagement, RoomSession } from "@workspace/api-client-react";
import { GiftBag } from "@/gifts/GiftBag";
import { GiftControl } from "@/gifts/GiftControl";
import { GiftComboPlayer, type GiftComboNotice } from "@/gifts/GiftComboPlayer";
import { appendUniqueGiftEvents, finishGiftQueueItem } from "@/gifts/gift-combo-policy";
import { SafetyReportDialog } from "@/safety/SafetyReportDialog";
import { ShinyName } from "@/components/ShinyName";
import { saveCreds } from "@/lib/room-creds";
import { ProfileTap } from "@/profile/QuickProfile";
import { isLiveStreamEventVisible } from "./liveChatBlockPolicy";
import { LiveViewerActions } from "./LiveViewerActions";
import { PkBattleStage } from "./PkBattleStage";
import "./pk-battle.css";
import {
  hostLiveSession, leaveViewerLiveSession, viewerLiveSession,
  type HostLiveSnapshot, type ViewerLiveSnapshot,
} from "./liveSessionController";
import "./live-stream.css";

type GiftNotice = GiftComboNotice & {
  senderUsername: string;
  giftName: string;
  quantity: number;
  cost: number;
};
type ActionTarget = { username: string; displayName: string; displayNameColor?: string; displayNameTierIndex?: number };
type ReportTarget = {
  targetType: "user" | "message" | "stream";
  targetUsername: string;
  streamId?: string;
  messageId?: string;
  messageText?: string;
};

const base = import.meta.env.BASE_URL;
const liveEndpoint = (streamId: string, suffix: string) =>
  `${base}api/account/live-streams/${encodeURIComponent(streamId)}/${suffix}`;

function useHostSnapshot() {
  return useSyncExternalStore(hostLiveSession.subscribe, hostLiveSession.getSnapshot, hostLiveSession.getSnapshot);
}

function useViewerSnapshot(controller: ReturnType<typeof viewerLiveSession>) {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

function leadingEmoji(text: string) {
  const first = [...text.trim()][0];
  return first && /\p{Extended_Pictographic}/u.test(first) ? first : null;
}

function useLiveChat(streamId: string, enabled: boolean, blocked: string[], onGift: (gift: GiftNotice, animate: boolean) => void) {
  const [messages, setMessages] = useState<LiveStreamChatMessage[]>([]);
  const [engagement, setEngagement] = useState<LiveStreamEngagement>({ hearts: 0, shares: 0 });
  const [connectionMessage, setConnectionMessage] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [text, setText] = useState("");
  const longPress = useRef<number | undefined>(undefined);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [profile, setProfile] = useState<ActionTarget | null>(null);
  const blockedKey = blocked.join("|");
  const seenGiftIds = useRef(new Set<string>());
  useEffect(() => {
    seenGiftIds.current.clear();
    setMessages([]);
    setEngagement({ hearts: 0, shares: 0 });
    setConnectionMessage("");
  }, [streamId]);

  useEffect(() => {
    if (!enabled || !streamId) return;
    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let retryDelay = 1000;
    let disposed = false;
    const blockedNames = new Set(blocked.map(name => name.toLowerCase()));
    const receiveMessage = (event: MessageEvent<string>) => {
      try {
        const item = JSON.parse(event.data) as LiveStreamChatMessage;
        if (!item.id || !item.username || !item.text) return;
        setConnectionMessage("");
        if (!isLiveStreamEventVisible("message", item.username, blockedNames)) return;
        setMessages(current => current.some(existing => existing.id === item.id)
          ? current : [...current, item].slice(-120));
      } catch { /* Ignore malformed events. */ }
    };
    const receiveGift = (event: MessageEvent<string>, animate: boolean) => {
      try {
        const gift = JSON.parse(event.data) as GiftNotice;
        if (!gift.id || !gift.senderUsername || !gift.giftId || seenGiftIds.current.has(gift.id)
          || !isLiveStreamEventVisible("gift", gift.senderUsername, blockedNames)) return;
        seenGiftIds.current.add(gift.id);
        const age = gift.createdAt ? Date.now() - new Date(gift.createdAt).getTime() : Number.POSITIVE_INFINITY;
        const recentHistoryEvent = !animate && age >= -5000 && age <= 10_000;
        onGift({ ...gift, quantity: gift.quantity || 1 }, animate || recentHistoryEvent);
      } catch { /* Ignore malformed events. */ }
    };
    const receiveEngagement = (event: MessageEvent<string>) => {
      try {
        const value = JSON.parse(event.data) as LiveStreamEngagement;
        if (!Number.isSafeInteger(value.hearts) || !Number.isSafeInteger(value.shares)
          || value.hearts < 0 || value.shares < 0) return;
        setEngagement(value);
      } catch { /* Ignore malformed events. */ }
    };
    const connect = () => {
      if (disposed) return;
      const current = new EventSource(liveEndpoint(streamId, "chat/events"), { withCredentials: true });
      source = current;
      current.addEventListener("message", receiveMessage as EventListener);
      current.addEventListener("gift", ((event: MessageEvent<string>) => receiveGift(event, true)) as EventListener);
      current.addEventListener("gift-history-item", ((event: MessageEvent<string>) => receiveGift(event, false)) as EventListener);
      current.addEventListener("engagement", receiveEngagement as EventListener);
      current.onopen = () => { retryDelay = 1000; setConnectionMessage(""); };
      current.onerror = () => {
        if (disposed) return;
        setConnectionMessage("Live chat is reconnecting…");
        if (current.readyState === EventSource.CLOSED) {
          current.close();
          retryTimer = window.setTimeout(connect, retryDelay);
          retryDelay = Math.min(15_000, retryDelay * 2);
        }
      };
    };
    connect();
    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      source?.close();
    };
  // blockedKey is a value key so refetching the same block list does not reset SSE.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, streamId, blockedKey, onGift]);

  useEffect(() => {
    const excluded = new Set(blocked.map(name => name.toLowerCase()));
    setMessages(current => current.filter(message =>
      isLiveStreamEventVisible("message", message.username, excluded),
    ));
  }, [blockedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const log = logRef.current;
    if (log && pinned.current) log.scrollTop = log.scrollHeight;
  }, [messages]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim().slice(0, 280);
    if (!body || !enabled) return;
    setConnectionMessage("");
    try {
      await sendLiveStreamChatMessage(streamId, { text: body }, { credentials: "include" });
      setText("");
    } catch {
      setConnectionMessage("Your message could not be sent. Check your connection.");
    }
  };

  return {
    messages, engagement, setEngagement, text, setText, connectionMessage, logRef, pinned, longPress,
    send, profile, setProfile, report, setReport,
  };
}

function LocalPreview({ stream, videoRef, onBlocked }: {
  stream: MediaStream;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onBlocked: () => void;
}) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    video.muted = true;
    (video as HTMLVideoElement).playsInline = true;
    let frameTimer: number | undefined;
    const checkFrame = () => {
      if (video.videoWidth === 0 || video.videoHeight === 0) onBlocked();
    };
    video.addEventListener("loadeddata", checkFrame);
    void video.play().then(() => {
      frameTimer = window.setTimeout(checkFrame, 2500);
    }).catch(onBlocked);
    return () => {
      video.removeEventListener("loadeddata", checkFrame);
      if (frameTimer) window.clearTimeout(frameTimer);
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [stream, onBlocked, videoRef]);
  return <video ref={videoRef} className="st-live-video" autoPlay muted playsInline />;
}

function RemoteVideo({ track }: { track: RemoteTrack }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const video = track.attach();
    video.className = "st-live-video";
    video.autoplay = true;
    (video as HTMLVideoElement).playsInline = true;
    video.muted = true;
    element.replaceChildren(video);
    return () => { track.detach(video); video.remove(); };
  }, [track]);
  return <div className="st-live-remote-video" ref={ref} />;
}

function RemoteAudio({ track }: { track: RemoteTrack }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const audio = track.attach();
    audio.autoplay = true;
    element.replaceChildren(audio);
    return () => { track.detach(audio); audio.remove(); };
  }, [track]);
  return <div className="st-live-remote-audio" ref={ref} />;
}

function GifterAvatar({ username, name, coins }: { username: string; name: string; coins: number }) {
  const person = useGetSocialPerson(username, {
    query: { queryKey: getGetSocialPersonQueryKey(username), enabled: Boolean(username) },
  });
  const photo = person.data?.photoUrl;
  return <ProfileTap username={username} label={`Open profile for ${name}`}><span className="st-live-gifter-avatar" title={`${name} · ${coins} coins`}>
    {photo ? <img src={photo} alt="" /> : [...name][0]?.toUpperCase() ?? "?"}
  </span></ProfileTap>;
}

function liveGiftRecipients(
  room: HostLiveSnapshot["room"],
  hostUsername: string,
  hostDisplayName: string,
) {
  if (!room || !hostUsername) return [];
  return [{ username: hostUsername, displayName: hostDisplayName || hostUsername, isHost: true }];
}

import { PinkCardAnnouncement } from "./PinkCardAnnouncement";

export function LiveSurface({ streamId, hostMode, hostState, viewerState, onEnd, onLeave, ownUsername }: {
  streamId: string;
  hostMode: boolean;
  hostState?: HostLiveSnapshot;
  viewerState?: ViewerLiveSnapshot;
  onEnd?: () => void;
  onLeave?: () => void;
  ownUsername: string;
}) {
  const queryClient = useQueryClient();
  const blocks = useGetSocialBlocks({ query: { queryKey: getGetSocialBlocksQueryKey(), refetchInterval: 10_000 } });
  const blocked = useMemo(() => blocks.data?.people.map(person => person.username) ?? [], [blocks.data?.people]);
  const setRelationship = useSetSocialRelationship();
  const session = hostMode ? hostState?.session : viewerState?.session;
  const hostUsername = session?.username ?? "";
  const displayName = session?.displayName ?? "Live creator";
  const hostPerson = useGetSocialPerson(hostUsername, {
    query: { queryKey: getGetSocialPersonQueryKey(hostUsername), enabled: Boolean(hostUsername) && !hostMode },
  });
  const ownProfile = useGetSocialMe({
    query: { queryKey: getGetSocialMeQueryKey(), enabled: Boolean(ownUsername) },
  });
  const hostPhoto = hostMode ? ownProfile.data?.profile.photoUrl : hostPerson.data?.photoUrl;
  const hostNameColor = hostMode ? ownProfile.data?.profile.displayNameColor : hostPerson.data?.displayNameColor;
  const hostNameTier = hostMode ? ownProfile.data?.profile.displayNameTierIndex : hostPerson.data?.displayNameTierIndex;
  const avatar = leadingEmoji(displayName);
  const viewerController = viewerLiveSession(streamId);
  const chatReady = hostMode ? Boolean(hostState?.chatReady) : viewerState?.phase === "live";
  const [giftOpen, setGiftOpen] = useState(false);
  const [liveGifters, setLiveGifters] = useState<Map<string, { username: string; name: string; coins: number }>>(() => new Map());
  const [giftQueue, setGiftQueue] = useState<GiftNotice[]>([]);
  const activeGift = giftQueue[0] ?? null;
  const [error, setError] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const [profileAction, setProfileAction] = useState<ActionTarget | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [canManageStream, setCanManageStream] = useState(false);
  const [roomBlocks, setRoomBlocks] = useState<Array<{ accountId: string; username: string }>>([]);
  const [roomBlockPanelOpen, setRoomBlockPanelOpen] = useState(false);
  const [roomBlockUsername, setRoomBlockUsername] = useState("");
  const [moderationBusy, setModerationBusy] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const shareTimer = useRef<number | undefined>(undefined);
  const status = hostMode
    ? hostState?.phase === "live" ? "connected" : hostState?.phase === "livekit-error" ? "reconnecting" : "connecting"
    : viewerState?.phase === "live" ? "connected" : viewerState?.phase === "error" ? "reconnecting" : "connecting";
  const videoTrack = viewerState?.videoTrack ?? null;
  const audioTrack = viewerState?.audioTrack ?? null;
  const localStream = hostState?.localStream ?? null;
  const pkState = useGetPkBattleState(streamId, {
    query: {
      queryKey: getGetPkBattleStateQueryKey(streamId),
      enabled: chatReady,
      refetchInterval: 2_000,
      staleTime: 0,
    },
    request: { credentials: "include" },
  });
  const pkBattle = pkState.data?.state === "battle" ? pkState.data.battle : null;
  const [pkActionError, setPkActionError] = useState("");
  const [pkActionBusy, setPkActionBusy] = useState(false);
  const viewerCount = hostMode ? hostState?.viewerCount ?? 0 : viewerState?.viewerCount ?? 0;
  const muted = hostMode ? !hostState?.microphoneEnabled : false;
  const audioEnabled = viewerState?.audioEnabled ?? false;
  const [giftFeed, setGiftFeed] = useState<GiftNotice[]>([]);
  useEffect(() => { setLiveGifters(new Map()); setGiftQueue([]); setGiftFeed([]); }, [streamId]);
  const chat = useLiveChat(streamId, chatReady, blocked, useCallback((gift: GiftNotice, animate: boolean) => {
    setGiftFeed(current => current.some(item => item.id === gift.id) ? current : [...current, gift].slice(-30));
    setLiveGifters(current => {
      const usernameKey = gift.senderUsername.toLowerCase();
      const next = new Map(current);
      const existing = next.get(usernameKey);
      next.set(usernameKey, {
        username: gift.senderUsername,
        name: gift.senderName,
        coins: (existing?.coins ?? 0) + gift.cost,
      });
      return next;
    });
    if (animate) setGiftQueue(current => appendUniqueGiftEvents(current, [gift]));
  }, []));
  const joinNotice = hostState?.joinNotice || viewerState?.joinNotice || "";
  const [arrivalFeed, setArrivalFeed] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => { setArrivalFeed([]); }, [streamId]);
  useEffect(() => {
    if (joinNotice) setArrivalFeed(current => [...current, { id: crypto.randomUUID(), name: joinNotice }].slice(-30));
  }, [joinNotice]);
  useEffect(() => {
    const log = chat.logRef.current;
    if (log && chat.pinned.current) log.scrollTop = log.scrollHeight;
  }, [giftFeed, joinNotice, chat.logRef, chat.pinned]);
  const gifterTotals = useMemo(() => {
    return [...liveGifters.values()]
      .sort((a, b) => b.coins - a.coins)
      .slice(0, 3);
  }, [liveGifters]);
  const following = hostPerson.data?.favorite ?? false;
  const myName = ownProfile.data?.profile.username ?? ownUsername;
  const myDisplayName = ownProfile.data?.profile.displayName || myName;
  const giftRoom = hostMode ? hostState?.room ?? null : viewerState?.room ?? null;
  const giftRecipients = liveGiftRecipients(giftRoom, hostUsername, displayName);
  const refreshRoomBlocks = useCallback(async () => {
    const response = await fetch(liveEndpoint(streamId, "host-blocks"), {
      credentials: "include", cache: "no-store",
    });
    if (!response.ok) {
      setCanManageStream(false);
      return;
    }
    const data = await response.json() as { people?: Array<{ accountId: string; username: string }> };
    setCanManageStream(true);
    setRoomBlocks(data.people ?? []);
  }, [streamId]);
  useEffect(() => {
    if (!chatReady) return;
    void refreshRoomBlocks().catch(() => setCanManageStream(false));
  }, [chatReady, refreshRoomBlocks]);

  const markCameraBlocked = useCallback(() => setCameraBlocked(true), []);
  const retryCameraPlayback = useCallback(async () => {
    try {
      if (localVideoRef.current?.srcObject) {
        await localVideoRef.current.play();
        await new Promise(resolve => window.setTimeout(resolve, 120));
        if (localVideoRef.current.videoWidth > 0) {
          setCameraBlocked(false);
          return;
        }
      }
    } catch {
      setCameraBlocked(true);
    }
    await hostLiveSession.retryCamera(ownUsername);
  }, [ownUsername]);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ streamId?: string }>).detail;
      if (detail?.streamId === streamId) setGiftOpen(true);
    };
    window.addEventListener("streamtalk:open-live-gifts", open);
    return () => window.removeEventListener("streamtalk:open-live-gifts", open);
  }, [streamId]);

  const profileFor = (username: string, name: string, color?: string, tier?: number) => {
    if (username && username.toLowerCase() !== ownUsername.toLowerCase()) {
      setProfileAction({ username, displayName: name, displayNameColor: color, displayNameTierIndex: tier });
    }
  };
  const closeProfile = () => setProfileAction(null);
  const openStreamReport = () => hostUsername && setReportTarget({ targetType: "stream", targetUsername: hostUsername, streamId });
  const blockSelectedUser = () => {
    if (!profileAction) return;
    const target = profileAction;
    setRelationship.mutate({ username: target.username, data: { kind: "block", active: true } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetSocialBlocksQueryKey() });
        setProfileAction(null);
      },
      onError: () => setError("That account could not be blocked right now. Try again."),
    });
  };
  const setHostRoomBlock = async (username: string, active: boolean) => {
    if (moderationBusy) return;
    setModerationBusy(true);
    try {
      const path = hostMode
        ? `${base}api/account/host-room-blocks/${encodeURIComponent(username)}`
        : liveEndpoint(streamId, `host-blocks/${encodeURIComponent(username)}`);
      const response = await fetch(path, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!response.ok) throw new Error("Host room block update failed");
      await refreshRoomBlocks();
      setProfileAction(null);
    } catch {
      setError("Could not update this host-room block right now.");
    } finally {
      setModerationBusy(false);
    }
  };
  const kickSelected = async () => {
    if (!profileAction || moderationBusy) return;
    setModerationBusy(true);
    try {
      const response = await fetch(liveEndpoint(streamId, `kick/${encodeURIComponent(profileAction.username)}`), {
        method: "POST", credentials: "include",
      });
      if (!response.ok) throw new Error("Room removal failed");
      setProfileAction(null);
    } catch {
      setError("Could not remove this person from the room right now.");
    } finally {
      setModerationBusy(false);
    }
  };
  const blockEnteredUsername = async (event: FormEvent) => {
    event.preventDefault();
    const username = roomBlockUsername.trim();
    if (!username) return;
    await setHostRoomBlock(username, true);
    setRoomBlockUsername("");
  };
  const follow = () => {
    if (!hostUsername || setRelationship.isPending) return;
    setRelationship.mutate({ username: hostUsername, data: { kind: "favorite", active: !following } }, {
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: getGetSocialPersonQueryKey(hostUsername) }),
      onError: () => setError("Could not update your follow right now. Try again."),
    });
  };
  const finishGift = (giftId: string) => setGiftQueue(current => finishGiftQueueItem(current, giftId));
  const share = async () => {
    const path = base.endsWith("/") ? base : `${base}/`;
    const url = new URL(`${path}live/${encodeURIComponent(streamId)}`, window.location.origin).toString();
    try {
      if (navigator.share) await navigator.share({ title: `${displayName} is live on Big Apple Live`, text: "Join my live stream", url });
      else {
        await navigator.clipboard.writeText(url);
        setShareNotice("Stream link copied");
        if (shareTimer.current) window.clearTimeout(shareTimer.current);
        shareTimer.current = window.setTimeout(() => setShareNotice(""), 2400);
      }
      try {
        chat.setEngagement(await addLiveStreamShare(streamId, { credentials: "include" }));
      } catch {
        setShareNotice("Shared, but the count could not be updated.");
      }
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError")) setError("Could not share the stream link.");
    }
  };
  const enableStreamAudio = () => void viewerController.enableAudio();
  const startPkSearch = async () => {
    if (pkActionBusy) return;
    setPkActionBusy(true);
    setPkActionError("");
    try {
      await searchPkOpponent(streamId, { credentials: "include" });
      await queryClient.invalidateQueries({ queryKey: getGetPkBattleStateQueryKey(streamId) });
    } catch (failure) {
      setPkActionError(failure instanceof Error ? failure.message : "Could not start a PK search.");
    } finally {
      setPkActionBusy(false);
    }
  };
  const stopPkSearch = async () => {
    if (pkActionBusy) return;
    setPkActionBusy(true);
    setPkActionError("");
    try {
      await cancelPkOpponentSearch(streamId, { credentials: "include" });
      await queryClient.invalidateQueries({ queryKey: getGetPkBattleStateQueryKey(streamId) });
    } catch (failure) {
      setPkActionError(failure instanceof Error ? failure.message : "Could not cancel the PK search.");
    } finally {
      setPkActionBusy(false);
    }
  };

  return <main className={`st-live-room${hostMode ? " is-host" : " is-viewer"}${hostMode && hostState?.cameraFacing === "user" ? " is-front-camera" : ""}`}
    data-testid="live-room">
    {hostMode && <PinkCardAnnouncement path={`/live/${encodeURIComponent(streamId)}`} />}
    <div className="st-live-player">
      {pkBattle
        ? <PkBattleStage battle={pkBattle} streamId={streamId} hostMode={hostMode} localStream={localStream}
            localTracks={hostState?.localTracks ?? []} microphoneEnabled={hostState?.microphoneEnabled ?? false}
            cameraFacing={hostState?.cameraFacing ?? "user"} />
        : hostMode && localStream
        ? <LocalPreview stream={localStream} videoRef={localVideoRef} onBlocked={markCameraBlocked} />
        : !hostMode && videoTrack
          ? <RemoteVideo track={videoTrack} />
          : !hostMode && <div className="st-live-player-empty">
            <ProfileTap username={hostUsername}><span className="st-live-avatar">{avatar ?? (hostPhoto ? <img src={hostPhoto} alt="" /> : displayName[0]?.toUpperCase() ?? "S")}</span></ProfileTap>
            <strong><ShinyName displayNameColor={hostNameColor} displayNameTierIndex={hostNameTier}>{displayName}</ShinyName></strong><span>Waiting for the host’s camera…</span>
          </div>}
      {hostMode && (!localStream || cameraBlocked) && (
        <div className="st-live-camera-recovery" data-testid="live-camera-recovery">
          <strong>{cameraBlocked || hostState?.phase === "camera-error" ? "Camera preview is unavailable" : "Starting your camera…"}</strong>
          <span>{hostState?.error || (cameraBlocked
            ? "Tap below to retry. If this is an in-app browser, open the link in Chrome or Brave."
            : "Allow camera access to show your live video. If this is an in-app browser, open the link in Chrome or Brave.")}</span>
          <button type="button" data-testid="live-start-camera" onClick={() => {
            setCameraBlocked(false);
            void retryCameraPlayback();
          }}>Tap to start camera</button>
        </div>
      )}
      <div className="st-live-topbar">
        <div className="st-live-creator">
          <ProfileTap username={hostUsername} label={`Open profile for ${displayName}`}>
            <span className="st-live-creator-avatar" data-testid="live-creator-avatar">{avatar ?? (hostPhoto ? <img src={hostPhoto} alt="" /> : displayName[0]?.toUpperCase() ?? "S")}</span>
          </ProfileTap>
          <button type="button" className="st-live-creator-profile" disabled={hostMode || !hostUsername}
            onClick={() => profileFor(hostUsername, displayName, hostNameColor, hostNameTier)} data-testid="live-creator-profile">
            <span className="st-live-creator-copy"><strong><ShinyName displayNameColor={hostNameColor} displayNameTierIndex={hostNameTier}>{displayName}</ShinyName></strong>
              <small><i className={status === "connected" ? "is-live" : ""} />{status === "connected" ? "LIVE NOW" : status === "reconnecting" ? "Reconnecting" : "Connecting"}</small>
            </span>
          </button>
          {!hostMode && <button type="button" className={`st-live-follow${following ? " is-following" : ""}`}
            onClick={follow} disabled={!hostUsername || setRelationship.isPending}>{following ? "Following" : "Follow"}</button>}
        </div>
        <div className="st-live-top-actions">
          <div className="st-live-viewers" data-testid="live-viewer-count"><Eye size={15} /><span>{viewerCount.toLocaleString()}</span></div>
          <div className="st-live-gifters" aria-label="Top gifters">
            {gifterTotals.length ? gifterTotals.map(item => <GifterAvatar key={item.username} {...item} />) : <small>Top gifters</small>}
          </div>
          {hostMode
            ? <button type="button" className="st-live-close-button st-live-end" data-testid="live-end-stream"
              onClick={() => { void hostLiveSession.end().then(() => onEnd?.()); }}><X size={18} /><span>End</span></button>
            : <button type="button" className="st-live-close-button" data-testid="live-leave" onClick={() => onLeave?.()} aria-label="Leave live stream"><X size={19} /></button>}
        </div>
      </div>
      {!hostMode && audioTrack && !audioEnabled && <button type="button" className="st-live-audio-enable"
        onClick={enableStreamAudio} data-testid="live-enable-audio">Tap to hear stream</button>}
      {!hostMode && <button type="button" className="st-live-report-stream" onClick={openStreamReport}
        aria-label="Report stream" data-testid="live-report-stream"><Flag size={16} /></button>}
      {!hostMode && chatReady && <LiveViewerActions
        streamId={streamId}
        hostUsername={hostUsername}
        hostDisplayName={displayName}
        isPk={Boolean(pkBattle)}
        engagement={chat.engagement}
        onEngagement={chat.setEngagement}
        onOpenGifts={() => setGiftOpen(true)}
      />}
      {(error || hostState?.phase === "livekit-error" || viewerState?.phase === "error") && (
        <div className="st-live-error" role="status" data-testid="live-error">
          <span>{error || hostState?.error || viewerState?.error}</span>
          {hostMode && hostState?.phase === "livekit-error" && <button type="button"
            onClick={() => void hostLiveSession.retryConnection(ownUsername)}>Retry connection</button>}
          {!hostMode && viewerState?.phase === "error" && <button type="button" onClick={() => void viewerController.retry()}>Try again</button>}
        </div>
      )}
      {shareNotice && <div className="st-live-share-status" role="status">{shareNotice}</div>}
      <div className="st-live-chat-overlay">
        <section className="st-live-chat" aria-label="Livestream chat">
          <h2>Live chat</h2>
          <div className="st-live-chat-log" role="log" aria-live="polite" ref={chat.logRef}
            onScroll={() => {
              const log = chat.logRef.current;
              if (log) chat.pinned.current = log.scrollHeight - log.scrollTop - log.clientHeight < 28;
            }}>
            {!chat.messages.length && !giftFeed.length && !arrivalFeed.length && (
              <p className="st-live-chat-line st-live-feed-empty">Comments, arrivals and gifts appear here.</p>
            )}
            {chat.messages.map(message => (
              <p className="st-live-chat-line" key={message.id}
                onContextMenu={event => {
                  if (message.username === myName) return;
                  event.preventDefault();
                  chat.setReport({ targetType: "message", targetUsername: message.username, streamId, messageId: message.id, messageText: message.text });
                }}
                onTouchStart={() => {
                  if (message.username === myName) return;
                  if (chat.longPress.current) window.clearTimeout(chat.longPress.current);
                  chat.longPress.current = window.setTimeout(() => chat.setReport({
                    targetType: "message", targetUsername: message.username, streamId, messageId: message.id, messageText: message.text,
                  }), 600);
                }}
                onTouchMove={() => { if (chat.longPress.current) window.clearTimeout(chat.longPress.current); chat.longPress.current = undefined; }}
                onTouchEnd={() => { if (chat.longPress.current) window.clearTimeout(chat.longPress.current); chat.longPress.current = undefined; }}
                onTouchCancel={() => { if (chat.longPress.current) window.clearTimeout(chat.longPress.current); chat.longPress.current = undefined; }}>
                <span className="st-live-chat-author">
                  {message.badgeImage && <img className="st-live-chat-badge" src={message.badgeImage} alt={message.badgeName ? `${message.badgeName} badge` : "User badge"} />}
                  {message.username === myName
                    ? <strong><ShinyName displayNameColor={message.displayNameColor} displayNameTierIndex={message.displayNameTierIndex}>{message.displayName}</ShinyName></strong>
                    : <button type="button" className="st-live-chat-name"
                      onClick={() => profileFor(message.username, message.displayName, message.displayNameColor, message.displayNameTierIndex)}><ShinyName displayNameColor={message.displayNameColor} displayNameTierIndex={message.displayNameTierIndex}>{message.displayName}</ShinyName></button>}
                </span>
                <span className="st-live-chat-text">{message.text}</span>
              </p>
            ))}
            {giftFeed.map(gift => (
              <p className="st-live-chat-line st-live-feed-gift" key={`gift-${gift.id}`} data-testid={`live-feed-gift-${gift.id}`}>
                <span className="st-live-chat-author"><strong>{gift.senderName || gift.senderUsername}</strong></span>
                <span className="st-live-chat-text">sent {gift.giftName}{gift.quantity > 1 ? ` x${gift.quantity}` : ""}</span>
              </p>
            ))}
            {arrivalFeed.map(arrival => <p className="st-live-chat-line st-live-feed-join" key={arrival.id} data-testid="live-feed-join">
              <span className="st-live-chat-author"><strong>{arrival.name}</strong></span>
              <span className="st-live-chat-text">joined</span>
            </p>)}
          </div>
          {chat.connectionMessage && <p className="st-live-chat-connection" role="status">{chat.connectionMessage}</p>}
          <form className="st-live-chat-form" onSubmit={chat.send}>
            <label className="st-live-sr" htmlFor="st-live-chat-input">Write a chat message</label>
            <input id="st-live-chat-input" value={chat.text} onChange={event => chat.setText(event.target.value)}
              maxLength={280} placeholder="Say something…" disabled={!chatReady} />
            <button type="submit" className="bm-btn bm-btn-primary" disabled={!chatReady || !chat.text.trim()} aria-label="Send message"><Send size={17} aria-hidden="true" /></button>
          </form>
        </section>
      </div>
      <div className={`st-live-bottom-controls dw-live-dock${hostMode ? ' is-host' : ''}`} data-testid="dock-live-controls">
        <GiftControl label="Open live gifts" onClick={() => setGiftOpen(true)} />
        {hostMode && <div className="st-live-host-controls">
            <button type="button" onClick={() => void hostLiveSession.flipCamera()} aria-label="Flip camera"><FlipHorizontal size={18} /><span>Flip</span></button>
            <button type="button" className={muted ? "is-mic-off" : "is-mic-on"} onClick={() => void hostLiveSession.toggleMicrophone()}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"} aria-pressed={!muted}>{muted ? <MicOff size={18} /> : <Mic size={18} />}<span>{muted ? "Mic off" : "Mic on"}</span></button>
            <button type="button" onClick={() => void share()} aria-label="Share stream link"><Share2 size={18} /><span>Share</span></button>
          </div>}
          {canManageStream && <div className="st-live-host-controls">
            <button type="button" aria-expanded={roomBlockPanelOpen} onClick={() => setRoomBlockPanelOpen(value => !value)}>
              <Ban size={18} /><span>Blocks</span>
            </button>
          </div>}
          {hostMode && chatReady && !pkBattle && <div className="st-pk-control" data-testid="pk-live-controls">
            <button type="button" className={pkState.data?.state === "searching" ? "st-pk-cancel" : "st-pk-search"}
              onClick={() => void (pkState.data?.state === "searching" ? stopPkSearch() : startPkSearch())}
              disabled={pkActionBusy}
              aria-label={pkState.data?.state === "searching" ? "Cancel PK opponent search" : "Search for a PK opponent"}
              data-testid="button-pk-search">
              {pkState.data?.state === "searching" ? <X size={17} /> : <Swords size={17} />}
              <span>{pkState.data?.state === "searching" ? "Cancel" : "PK"}</span>
            </button>
            {pkState.data?.state === "searching" && <span className="st-pk-status" role="status">
              <i className="st-pk-search-status-dot" />Finding opponent…
            </span>}
            {pkState.data?.state === "timed_out" && <span className="st-pk-status is-error" role="status">
              No one's available, try again.
            </span>}
            {pkActionError && <span className="st-pk-status is-error" role="alert">{pkActionError}</span>}
          </div>}
      </div>
    </div>
    {roomBlockPanelOpen && canManageStream && <section className="st-live-block-panel" aria-label="People blocked from this host's rooms">
      <strong>Blocked from this host’s rooms</strong>
      <form onSubmit={event => void blockEnteredUsername(event)}>
        <label className="st-live-sr" htmlFor="st-live-block-username">Username to block</label>
        <input id="st-live-block-username" value={roomBlockUsername} onChange={event => setRoomBlockUsername(event.target.value)}
          maxLength={40} placeholder="Username" autoComplete="off" />
        <button type="submit" disabled={moderationBusy || !roomBlockUsername.trim()}>Block</button>
      </form>
      {roomBlocks.length ? <ul>{roomBlocks.map(person => <li key={person.accountId}>
        <span>{person.username}</span>
        <button type="button" disabled={moderationBusy} onClick={() => void setHostRoomBlock(person.username, false)}>Unblock</button>
      </li>)}</ul> : <p>No one is blocked from this host’s rooms.</p>}
    </section>}
    {audioTrack && !pkBattle && <RemoteAudio track={audioTrack} />}
    {giftOpen && <GiftBag recipients={giftRecipients} streamId={streamId} onClose={() => setGiftOpen(false)} />}
    {activeGift && <GiftComboPlayer
      key={activeGift.id}
      gift={activeGift}
      waitingCount={Math.max(0, giftQueue.length - 1)}
      onFinish={() => finishGift(activeGift.id)}
    />}
    {profileAction && <div className="st-live-action-scrim" onClick={() => setProfileAction(null)}>
      <section className="st-live-action-sheet" role="dialog" aria-modal="true" aria-label={`Actions for ${profileAction.displayName}`}
        onClick={event => event.stopPropagation()}>
        <button type="button" className="st-live-action-close" aria-label="Close" onClick={() => setProfileAction(null)}><X size={18} /></button>
        <span className="st-live-action-avatar">{leadingEmoji(profileAction.displayName) ?? profileAction.displayName[0]?.toUpperCase() ?? "S"}</span>
         <h2><ShinyName displayNameColor={profileAction.displayNameColor} displayNameTierIndex={profileAction.displayNameTierIndex}>{profileAction.displayName}</ShinyName></h2>
        <button type="button" onClick={() => { chat.setReport({ targetType: "user", targetUsername: profileAction.username, streamId }); setProfileAction(null); }}>
          <Flag size={16} /> Report user
        </button>
        {!hostMode && <button type="button" onClick={() => { openStreamReport(); setProfileAction(null); }}><Flag size={16} /> Report stream</button>}
        {canManageStream && profileAction.username.toLowerCase() !== ownUsername.toLowerCase() && <>
          <button type="button" disabled={moderationBusy} onClick={() => void kickSelected()}><X size={16} /> Remove from this room</button>
          <button type="button" disabled={moderationBusy} onClick={() => void setHostRoomBlock(profileAction.username, true)}>
            <Ban size={16} /> Block from this host’s rooms
          </button>
        </>}
        <button type="button" disabled={setRelationship.isPending} onClick={blockSelectedUser}><Ban size={16} /> Block</button>
      </section>
    </div>}
    {chat.report && <SafetyReportDialog targetType={chat.report.targetType} targetUsername={chat.report.targetUsername}
      streamId={chat.report.streamId} messageText={chat.report.messageText} messageId={chat.report.messageId} onClose={() => chat.setReport(null)} />}
    {reportTarget && <SafetyReportDialog targetType={reportTarget.targetType} targetUsername={reportTarget.targetUsername}
      streamId={reportTarget.streamId} messageText={reportTarget.messageText} messageId={reportTarget.messageId} onClose={() => setReportTarget(null)} />}
  </main>;
}

function HostStatusScreen({ snapshot, username, recoveryId, checking, onStart, onResume, onFresh, onBack }: {
  snapshot: HostLiveSnapshot; username: string; recoveryId: string | null; checking: boolean;
  onStart: () => void; onResume: () => void; onFresh: () => void; onBack: () => void;
}) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const ignoreBlocked = useCallback(() => undefined, []);
  return <main className="st-live-room is-host is-front-camera st-live-recovery-screen" data-testid="live-recovery-screen">
    {snapshot.localStream && <LocalPreview stream={snapshot.localStream} videoRef={localVideoRef} onBlocked={ignoreBlocked} />}
    <section className="st-live-camera-recovery st-live-recovery-card">
      <strong>{snapshot.phase === "camera-error" ? "Camera unavailable"
        : snapshot.phase === "conflict" ? "Your stream may still be active"
          : checking ? "Checking your live session…" : snapshot.localStream ? "Camera is ready"
            : recoveryId ? "Resume your live stream" : "Ready to go live?"}</strong>
      <span>{snapshot.error || (recoveryId
        ? "Your previous stream is still listed. Start the camera to reconnect."
        : "Tap once to start your camera and go live. If this is an in-app browser, use Chrome or Brave.")}</span>
      {snapshot.phase === "conflict" ? <div className="st-live-recovery-actions">
        {snapshot.conflictStreamId && <button type="button" onClick={onResume}>Rejoin stream</button>}
        <button type="button" onClick={onFresh}>End it &amp; start fresh</button>
      </div> : snapshot.phase === "server-error" && recoveryId ? <div className="st-live-recovery-actions">
        <button type="button" onClick={onResume}>Try reconnecting</button>
        <button type="button" onClick={onFresh}>End old stream &amp; go live</button>
      </div> : <button type="button" disabled={checking} onClick={recoveryId ? onResume : onStart}
        data-testid="live-start-camera">{recoveryId ? "Tap to start camera" : "Go live"}</button>}
      <button type="button" className="st-live-recovery-back" onClick={onBack}>Back to Big Apple Live</button>
      {username && <span className="st-live-sr">Signed in as @{username}</span>}
    </section>
  </main>;
}

export function StartLiveStreamPage() {
  const [snapshot, setSnapshot] = useState(hostLiveSession.getSnapshot());
  const me = useGetSocialMe();
  const [, navigate] = useLocation();
  const username = me.data?.profile?.username ?? "";
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const unsubscribe = hostLiveSession.subscribe(() => setSnapshot(hostLiveSession.getSnapshot()));
    return () => { unsubscribe(); };
  }, []);
  useEffect(() => {
    if (snapshot.phase !== "idle" || !username) return;
    let active = true;
    setChecking(true);
    void getLiveStreams({ credentials: "include" }).then(result => {
      if (!active) return;
      const current = result.streams.find(stream => stream.username.toLowerCase() === username.toLowerCase());
      setRecoveryId(current?.streamId ?? null);
    }).catch(() => { if (active) setRecoveryId(null); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [snapshot.phase, username]);
  const back = () => {
    void hostLiveSession.end();
    navigate("/home");
  };
  const start = () => void hostLiveSession.start(username);
  const resume = () => {
    const streamId = snapshot.conflictStreamId ?? recoveryId;
    if (streamId) void hostLiveSession.resume(streamId);
  };
  const fresh = () => void hostLiveSession.startFresh(username);
  if (snapshot.session) {
    return <LiveSurface streamId={snapshot.session.streamId} hostMode hostState={snapshot}
      ownUsername={username} onEnd={() => navigate("/home")} />;
  }
  return <HostStatusScreen snapshot={snapshot} username={username} recoveryId={recoveryId}
    checking={checking} onStart={start} onResume={resume} onFresh={fresh} onBack={back} />;
}

export function WatchLiveStreamPage({ streamId }: { streamId: string }) {
  const controller = viewerLiveSession(streamId);
  const snapshot = useViewerSnapshot(controller);
  const me = useGetSocialMe();
  const [, navigate] = useLocation();
  useEffect(() => { void controller.connect(); }, [controller]);
  useEffect(() => {
    const leave = () => leaveViewerLiveSession(streamId);
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [streamId]);
  if (snapshot.phase === "error" && !snapshot.session) {
    return <main className="st-live-room is-viewer st-live-recovery-screen">
      <section className="st-live-camera-recovery st-live-recovery-card">
        <strong>Live stream unavailable</strong><span>{snapshot.error}</span>
        <button type="button" onClick={() => void controller.retry()}>Try again</button>
        <button type="button" className="st-live-recovery-back" onClick={() => navigate("/home")}>Back to Big Apple Live</button>
      </section>
    </main>;
  }
  return <LiveSurface streamId={streamId} hostMode={false} viewerState={snapshot}
    ownUsername={me.data?.profile?.username ?? ""}
    onLeave={() => { leaveViewerLiveSession(streamId); navigate("/home"); }} />;
}

export function LiveStreamsDirectory() {
  const [streams, setStreams] = useState<LiveStreamEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const result = await getLiveStreams({ credentials: "include" });
      setStreams(result.streams);
      setError("");
    } catch {
      setError("Live streams are temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return <main className="st-live-page">
    <ScreenHeader className="st-live-page-head" backHref="/home" backLabel="Back to home" title="Live creators"
      subtitle={streams.length ? `${streams.length} live now` : 'Watch and chat with creators who are live now.'} testId="header-live-directory" />
    {loading && <p className="st-live-muted">Checking for live streams…</p>}
    {error && <p className="st-live-error" role="alert">{error}</p>}
    {!loading && !error && streams.length === 0 && <section className="st-live-empty"><Radio size={28} /><strong>No creator streams right now</strong><span>When someone goes live, they’ll appear here.</span></section>}
    <div className="st-live-directory-grid">{streams.map(stream => <Link className="st-live-directory-card" href={`/live/${stream.streamId}`} key={stream.streamId}>
      <div className="st-live-directory-thumb"><Video size={30} /><span className="st-live-state is-live"><i /> LIVE</span></div>
      <strong><ShinyName displayNameColor={stream.displayNameColor} displayNameTierIndex={stream.displayNameTierIndex}>{stream.displayName}</ShinyName></strong><span><Users size={15} /> {stream.viewerCount} watching</span><b>Watch live</b>
    </Link>)}</div>
  </main>;
}

export function GoLiveButton({ className, children }: { className: string; children: ReactNode }) {
  const [, navigate] = useLocation();
  const { user } = useUser();
  const qc = useQueryClient();
  const me = useGetSocialMe();
  const createRoom = useCreateAccountRoom();
  const createChess = useCreateChessRoom();
  const [choiceOpen, setChoiceOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const username = me.data?.profile?.username ?? "";
  const displayName = me.data?.profile?.displayName?.trim() || username || "Big Apple Live";
  const roomName = `${Array.from(displayName).slice(0, 25).join("").trimEnd()}'s Room`;

  useEffect(() => {
    if (!choiceOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !createRoom.isPending) setChoiceOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    dialog.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [choiceOpen, createRoom.isPending]);

  const startBroadcast = () => {
    if (!username) return;
    setChoiceOpen(false);
    void hostLiveSession.start(username);
    navigate("/live/start");
  };
  const createSocialRoom = () => {
    if (!username || !user?.id || createRoom.isPending) return;
    createRoom.mutate({ data: { name: roomName, capacity: 9 } }, {
      onSuccess: (session: RoomSession) => {
        saveCreds(user.id, session.room.roomId, {
          participantSessionId: session.participantSessionId,
          participantId: session.participantId,
        });
        qc.setQueryData(getGetRoomQueryKey(session.room.roomId), session.room);
        setChoiceOpen(false);
        navigate(`/rooms/${encodeURIComponent(session.room.roomId)}`);
      },
    });
  };

  const createChessGame = () => {
    if (!username || createChess.isPending) return;
    createChess.mutate(undefined, {
      onSuccess: (state) => {
        setChoiceOpen(false);
        navigate(`/community/chess/${encodeURIComponent(state.roomId)}`);
      },
    });
  };

  return <>
    <button ref={trigger} type="button" className={className} aria-haspopup="dialog"
      aria-expanded={choiceOpen} onClick={() => { createRoom.reset(); createChess.reset(); setChoiceOpen(true); }}>
      {children}
    </button>
    {choiceOpen && <div className="st-room-choice-scrim" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !createRoom.isPending) setChoiceOpen(false);
    }}>
      <section ref={dialog} className="st-room-choice-card" role="dialog" aria-modal="true"
        aria-labelledby="st-room-choice-title" data-testid="dialog-go-live-choice">
        <button type="button" className="st-room-choice-close" aria-label="Close choices"
          onClick={() => setChoiceOpen(false)} disabled={createRoom.isPending}><X size={18} /></button>
        <h2 id="st-room-choice-title">What would you like to start?</h2>
        <button type="button" className="st-room-choice-option" onClick={startBroadcast}
          disabled={!username} data-testid="button-start-live-broadcast">
          <span className="st-room-choice-icon"><Video size={22} /></span>
          <span><strong>Go Live</strong><small>Start your full-screen video broadcast.</small></span>
        </button>
        <button type="button" className="st-room-choice-option" onClick={createSocialRoom}
          disabled={!username || !user?.id || createRoom.isPending} data-testid="button-create-social-room">
          <span className="st-room-choice-icon"><Users size={22} /></span>
          <span><strong>{createRoom.isPending ? "Creating room…" : "Create Room"}</strong>
            <small>Open a nine-seat social room with chat and gifts.</small></span>
        </button>
        <button type="button" className="st-room-choice-option" onClick={createChessGame}
          disabled={!username || createChess.isPending} data-testid="button-create-chess-room">
          <span className="st-room-choice-icon"><Crown size={22} /></span>
          <span><strong>{createChess.isPending ? "Setting the board…" : "Chess"}</strong>
            <small>Invite one player to a head-to-head game with voice.</small></span>
        </button>
        {!username && (me.isLoading
          ? <p className="st-room-choice-error" role="status">Loading your account…</p>
          : <p className="st-room-choice-error" role="status">Set up your profile to continue. <Link href="/user-portal">Open profile</Link></p>)}
        {createRoom.isError && <p className="st-room-choice-error" role="alert">
          {createRoom.error instanceof Error ? createRoom.error.message : "Could not create your room. Try again."}
        </p>}
        {createChess.isError && <p className="st-room-choice-error" role="alert">Could not set up the chess room. Try again.</p>}
      </section>
    </div>}
  </>;
}
