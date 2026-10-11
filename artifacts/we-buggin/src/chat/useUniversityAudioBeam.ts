import { useCallback, useEffect, useRef, useState } from "react";
import {
  getUniversityAudioState,
  performUniversityAudioAction,
  type UniversityAudioActionInput,
  type UniversityAudioState,
} from "@workspace/api-client-react";
import { RoomAudioError, UniversityAudioClient, type AudioState } from "@workspace/room-audio";
import { errMessage } from "@/lib/errors";

const emptyState = (roomId: string): UniversityAudioState => ({
  roomId, beamActive: false, hostParticipantId: null,
  slots: [1, 2, 3, 4].map(slotNumber => ({
    slotNumber, participantId: null, micEnabled: false, mutedByHost: false,
  })),
});

export function useUniversityAudioBeam(
  roomId: string,
  roomSessionId: string,
  participantId: string,
) {
  const [beam, setBeam] = useState(() => emptyState(roomId));
  const [audioState, setAudioState] = useState<AudioState>("idle");
  const [clientRole, setClientRole] = useState<"listener" | "speaker">("listener");
  const [busy, setBusy] = useState(false);
  const [permissionPending, setPermissionPending] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const beamRef = useRef(beam);
  const clientRef = useRef<UniversityAudioClient | null>(null);
  const microphoneRef = useRef<MediaStream | null>(null);
  const roleRef = useRef<"listener" | "speaker">("listener");
  const activeRef = useRef(false);
  const actionRef = useRef(false);
  const latestArgs = useRef({ roomId, roomSessionId, participantId });
  latestArgs.current = { roomId, roomSessionId, participantId };

  const applyBeam = useCallback((state: UniversityAudioState) => {
    beamRef.current = state;
    setBeam(state);
  }, []);

  const headers = useCallback(() => ({ "X-Room-Session": latestArgs.current.roomSessionId }), []);

  const action = useCallback(async (input: UniversityAudioActionInput) => {
    if (!latestArgs.current.roomSessionId) throw new Error("Join the university first.");
    const state = await performUniversityAudioAction(
      latestArgs.current.roomId, input,
      { headers: headers(), credentials: "include" },
    );
    applyBeam(state);
    return state;
  }, [applyBeam, headers]);

  const startClient = useCallback(async (role: "listener" | "speaker", stream?: MediaStream) => {
    const args = latestArgs.current;
    if (!args.roomSessionId || !args.participantId || !activeRef.current) return;
    const client = new UniversityAudioClient({
      roomId: args.roomId,
      roomSessionId: args.roomSessionId,
      role,
      microphoneStream: stream,
      onState: next => setAudioState(next),
      onBeam: applyBeam,
      onSpeaking: ids => setSpeaking(new Set(ids)),
      onError: failure => {
        if (failure.code === "playback-blocked") setPlaybackBlocked(true);
        else setError(failure.message);
      },
    });
    clientRef.current = client;
    roleRef.current = role;
    setClientRole(role);
    try {
      await client.start();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not start room audio.");
      if (clientRef.current === client) clientRef.current = null;
      if (stream) stream.getTracks().forEach(track => track.stop());
      throw failure;
    }
  }, [applyBeam]);

  useEffect(() => {
    activeRef.current = true;
    applyBeam(emptyState(roomId));
    if (!roomSessionId || !participantId) {
      setAudioState("idle");
      return () => { activeRef.current = false; };
    }
    let current = true;
    let started = false;
    const load = async () => {
      try {
        const state = await getUniversityAudioState(roomId, {
          headers: { "X-Room-Session": roomSessionId }, credentials: "include",
        });
        if (!current) return;
        applyBeam(state);
        if (started) return;
        started = true;
        const staleOwnSlot = state.slots.some(slot => slot.participantId === participantId);
        // A reload or a previous tab must not silently retain an unowned speaker slot.
        if (staleOwnSlot) {
          const released = await performUniversityAudioAction(roomId, { action: "leave-slot" }, {
            headers: { "X-Room-Session": roomSessionId }, credentials: "include",
          });
          if (!current) return;
          applyBeam(released);
        }
        await startClient("listener");
      } catch (failure) {
        if (current) setError(errMessage(failure, "Could not connect to room audio."));
      }
    };
    void load();
    const refresh = setInterval(() => { void load(); }, 3_000);
    return () => {
      current = false;
      activeRef.current = false;
      clearInterval(refresh);
      const client = clientRef.current;
      clientRef.current = null;
      roleRef.current = "listener";
      microphoneRef.current = null;
      if (client) void client.stop();
      setSpeaking(new Set());
    };
  }, [roomId, roomSessionId, participantId, applyBeam, startClient]);

  const joinSlot = useCallback(async () => {
    if (actionRef.current || !roomSessionId || !participantId) return;
    actionRef.current = true;
    setBusy(true); setError(null); setPermissionPending(true);
    let stream: MediaStream | undefined;
    let ownsReservation = false;
    let speakerClientStarted = false;
    try {
      const reserved = await action({ action: "join-slot" });
      ownsReservation = true;
      if (!navigator.mediaDevices?.getUserMedia) throw new RoomAudioError("microphone-unavailable", "Microphone access is not available in this browser.");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      for (const track of stream.getAudioTracks()) track.enabled = false;
      const current = clientRef.current;
      clientRef.current = null;
      if (current) await current.stop();
      microphoneRef.current = stream;
      applyBeam(reserved);
      await startClient("speaker", stream);
      speakerClientStarted = true;
      // Joining is the user's explicit consent; after the browser grants mic
      // access, start sending without requiring a second, easy-to-miss tap.
      const enabled = await action({ action: "unmute-self" });
      const ownMicEnabled = enabled.slots.some(slot =>
        slot.participantId === participantId && slot.micEnabled && !slot.mutedByHost);
      for (const track of stream.getAudioTracks()) track.enabled = ownMicEnabled;
      setError(null);
    } catch (failure) {
      if (speakerClientStarted && clientRef.current) {
        const failedClient = clientRef.current;
        clientRef.current = null;
        try { await failedClient.stop(); } catch { /* continue to release the failed reservation */ }
      }
      stream?.getTracks().forEach(track => track.stop());
      microphoneRef.current = null;
      roleRef.current = "listener";
      setClientRole("listener");
      if (ownsReservation) {
        try { await action({ action: "leave-slot" }); } catch { /* the connection failure may already have cleared it */ }
      }
      setError(failure instanceof Error ? failure.message : "Could not join a speaker slot.");
      if (activeRef.current && !clientRef.current) {
        try { await startClient("listener"); } catch { /* the visible connection state reports this */ }
      }
    } finally {
      setPermissionPending(false); setBusy(false); actionRef.current = false;
    }
  }, [action, applyBeam, participantId, roomSessionId, startClient]);

  const leaveSlot = useCallback(async () => {
    if (actionRef.current) return;
    actionRef.current = true; setBusy(true); setError(null);
    try {
      const state = await action({ action: "leave-slot" });
      const client = clientRef.current;
      clientRef.current = null;
      microphoneRef.current = null;
      roleRef.current = "listener";
      if (client) await client.stop();
      applyBeam(state);
      if (activeRef.current) await startClient("listener");
    } catch (failure) {
      setError(errMessage(failure, "Could not leave the speaker slot."));
    } finally { setBusy(false); actionRef.current = false; }
  }, [action, applyBeam, startClient]);

  const setOwnMic = useCallback(async (enabled: boolean) => {
    if (actionRef.current) return;
    actionRef.current = true; setBusy(true); setError(null);
    try {
      const state = await action({ action: enabled ? "unmute-self" : "mute-self" });
      clientRef.current?.setMicrophoneEnabled(enabled && !beamRef.current.slots
        .find(slot => slot.participantId === participantId)?.mutedByHost);
      applyBeam(state);
    } catch (failure) { setError(errMessage(failure, "Could not update the microphone.")); }
    finally { setBusy(false); actionRef.current = false; }
  }, [action, applyBeam, participantId]);

  const hostMute = useCallback(async (targetParticipantId: string, muted: boolean) => {
    try {
      const state = await action({ action: muted ? "host-mute" : "host-unmute", targetParticipantId });
      applyBeam(state);
    } catch (failure) { setError(errMessage(failure, "Could not update that speaker's microphone.")); }
  }, [action, applyBeam]);

  const kickSpeaker = useCallback(async (targetParticipantId: string) => {
    try {
      const state = await action({ action: "kick", targetParticipantId });
      applyBeam(state);
    } catch (failure) { setError(errMessage(failure, "Could not remove that speaker.")); }
  }, [action, applyBeam]);

  const resumePlayback = useCallback(async () => {
    try { await clientRef.current?.resumePlayback(); setPlaybackBlocked(false); }
    catch { setPlaybackBlocked(true); }
  }, []);

  const ownSlot = beam.slots.find(slot => slot.participantId === participantId) ?? null;
  return {
    beam, audioState, clientRole, busy, permissionPending, playbackBlocked, error, speaking, ownSlot,
    isHost: !!participantId && beam.hostParticipantId === participantId,
    joinSlot, leaveSlot, setOwnMic, hostMute, kickSpeaker, resumePlayback,
  };
}
