import { createElement, useCallback, useEffect, useRef, useState } from "react";
import {
  getUniversityVideoBeamState,
  getUniversityVideoBeamToken,
  performUniversityVideoBeamAction,
  searchYouTubeForVideoBeam,
  type UniversityVideoBeamActionInput,
  type UniversityVideoBeamState,
  type UniversityVideoBeamTvSearchResponse,
} from "@workspace/api-client-react";
import {
  createLocalTracks,
  Room,
  RoomEvent,
  Track,
  type LocalTrack,
  type RemoteTrack,
} from "livekit-client";
import { errMessage, errStatus } from "@/lib/errors";
import { isBeamMicEnabled, shouldSubscribeToBeamAudio } from "./beam-audio-policy";

function safeBeamError(error: unknown, fallback: string): string {
  const message = errMessage(error, fallback);
  if ((errStatus(error) ?? 0) >= 500 || /internal server error/i.test(message)) return fallback;
  return message;
}
import type { RefObject } from "react";

type BeamConnection = "idle" | "connecting" | "connected" | "error";
type MediaMap = Record<string, { audio?: RemoteTrack | LocalTrack }>;

const emptyState = (roomId: string): UniversityVideoBeamState => ({
  roomId,
  beamActive: false,
  hostParticipantId: null,
  tv: {
    enabled: false,
    searchAvailable: false,
    defaultSearch: "",
    sourceType: null,
    sourceValue: null,
    playlistId: null,
    queue: [],
    videoMetadata: [],
    currentVideoId: null,
    startedAtMs: null,
    breakEndsAtMs: null,
    serverNowMs: Date.now(),
    micLockedDuringVideo: false,
    skipVotingEnabled: false,
    skipVoteCount: 0,
    skipVoteTotal: 0,
    hasVotedToSkip: false,
    skipSequence: 0,
    seriesTitle: null,
    seriesDate: null,
    seriesEpisodeNumber: null,
  },
  slots: [1, 2, 3, 4, 5, 6, 7, 8].map(slotNumber => ({
    slotNumber,
    participantId: null,
    micMuted: true,
    cameraOff: true,
    mutedByHost: false,
    cameraDisabledByHost: false,
  })),
});

function stopTracks(tracks: LocalTrack[]) {
  for (const track of tracks) {
    try { track.stop(); } catch { /* device may already be stopped */ }
  }
}

function syncAudioSubscriptions(
  room: Room,
  state: UniversityVideoBeamState,
  listenerId: string,
  blockedIds: ReadonlySet<string>,
  speakerConversationEnabled = false,
) {
  const listenerMicEnabled = speakerConversationEnabled
    && isBeamMicEnabled(state.slots.find(slot => slot.participantId === listenerId));
  for (const participant of room.remoteParticipants.values()) {
    const shouldSubscribe = !blockedIds.has(participant.identity)
      && shouldSubscribeToBeamAudio({
        listenerId,
        listenerMicEnabled,
        publisherId: participant.identity,
        slots: state.slots,
      });
    for (const publication of participant.trackPublications.values()) {
      if (publication.kind !== Track.Kind.Audio || publication.source !== Track.Source.Microphone) continue;
      if (publication.isSubscribed !== shouldSubscribe) publication.setSubscribed(shouldSubscribe);
    }
  }
}

export function useUniversityVideoBeam(
  roomId: string,
  roomSessionId: string,
  participantId: string,
  blockedParticipantIds: string[] = [],
) {
  const [beam, setBeam] = useState(() => emptyState(roomId));
  const [connection, setConnection] = useState<BeamConnection>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [media, setMedia] = useState<MediaMap>({});
  const [mediaVersion, setMediaVersion] = useState(0);
  const roomRef = useRef<Room | null>(null);
  const roleRef = useRef<"audience" | "speaker" | null>(null);
  const speakerReadyRef = useRef(false);
  const tracksRef = useRef<LocalTrack[]>([]);
  const activeRef = useRef(false);
  const startingRef = useRef(false);
  const actionRef = useRef(false);
  const latest = useRef({ roomId, roomSessionId, participantId });
  const blockedParticipantIdsRef = useRef(new Set(blockedParticipantIds));
  const beamRef = useRef(beam);
  latest.current = { roomId, roomSessionId, participantId };
  blockedParticipantIdsRef.current = new Set(blockedParticipantIds);
  beamRef.current = beam;

  const headers = useCallback((session: string) => ({ "X-Room-Session": session }), []);

  const applyBeam = useCallback((next: UniversityVideoBeamState) => {
    beamRef.current = next;
    const room = roomRef.current;
    if (room) {
      syncAudioSubscriptions(
        room, next, latest.current.participantId, blockedParticipantIdsRef.current,
        roleRef.current === "speaker" && speakerReadyRef.current,
      );
    }
    setBeam(next);
  }, []);

  const doAction = useCallback(async (
    args: { roomId: string; roomSessionId: string },
    data: UniversityVideoBeamActionInput,
  ) => performUniversityVideoBeamAction(args.roomId, data, {
    headers: headers(args.roomSessionId),
    credentials: "include",
  }), [headers]);

  const searchTv = useCallback(async (query: string): Promise<UniversityVideoBeamTvSearchResponse> => {
    const args = latest.current;
    return searchYouTubeForVideoBeam(args.roomId, { query }, {
      headers: headers(args.roomSessionId),
      credentials: "include",
    });
  }, [headers]);

  const reportTvPlaybackFailure = useCallback(async (videoId: string, errorCode: number) => {
    const args = latest.current;
    const response = await fetch(
      `/api/account/rooms/${encodeURIComponent(args.roomId)}/video-beam/tv/playback-failed`,
      {
        method: "POST",
        credentials: "include",
        headers: { ...headers(args.roomSessionId), "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, errorCode }),
      },
    );
    if (!response.ok) return;
    const nextTv = await response.json() as UniversityVideoBeamState["tv"];
    applyBeam({ ...beamRef.current, tv: nextTv });
  }, [applyBeam, headers]);

  const clearRoom = useCallback((stopLocal: boolean) => {
    const room = roomRef.current;
    roomRef.current = null;
    roleRef.current = null;
    speakerReadyRef.current = false;
    if (room) {
      try { room.removeAllListeners(); } catch { /* close may already be underway */ }
      void room.disconnect();
    }
    if (stopLocal) {
      stopTracks(tracksRef.current);
      tracksRef.current = [];
    }
    setMedia({});
    setSpeaking(new Set());
    setPlaybackBlocked(false);
  }, []);

  const connectAsAudience = useCallback(async (args: { roomId: string; roomSessionId: string; participantId: string }) => {
    if (!activeRef.current || startingRef.current || roomRef.current || !args.roomSessionId || !args.participantId) return;
    startingRef.current = true;
    setConnection("connecting");
    setError(null);
    try {
      const token = await getUniversityVideoBeamToken(args.roomId, { role: "audience" }, {
        headers: headers(args.roomSessionId),
        credentials: "include",
      });
      if (!activeRef.current || roomRef.current) return;
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      roleRef.current = "audience";
      const refreshMedia = () => {
        const snapshot: MediaMap = {};
        for (const participant of room.remoteParticipants.values()) {
          const entry: { audio?: RemoteTrack | LocalTrack } = {};
          for (const publication of participant.trackPublications.values()) {
            const track = publication.track;
            if (!track) continue;
            if (track.kind === Track.Kind.Audio && publication.source === Track.Source.Microphone) {
              entry.audio = track as RemoteTrack;
            }
          }
          snapshot[participant.identity] = entry;
        }
        setMedia(snapshot);
        setMediaVersion(version => version + 1);
      };
      const refreshSubscriptions = () => syncAudioSubscriptions(
        room, beamRef.current, args.participantId, blockedParticipantIdsRef.current,
      );
      room.on(RoomEvent.ParticipantConnected, refreshSubscriptions);
      room.on(RoomEvent.TrackPublished, refreshSubscriptions);
      room.on(RoomEvent.TrackUnpublished, refreshMedia);
      room.on(RoomEvent.TrackSubscribed, refreshMedia);
      room.on(RoomEvent.TrackUnsubscribed, refreshMedia);
      room.on(RoomEvent.TrackMuted, refreshMedia);
      room.on(RoomEvent.TrackUnmuted, refreshMedia);
      room.on(RoomEvent.ParticipantDisconnected, refreshMedia);
      room.on(RoomEvent.ActiveSpeakersChanged, speakers => setSpeaking(new Set(speakers.map(person => person.identity))));
      room.on(RoomEvent.ConnectionStateChanged, state => {
        if (roomRef.current !== room) return;
        if (state === "connected") setConnection("connected");
        if (state === "reconnecting") setConnection("connecting");
        if (state === "disconnected" && activeRef.current) {
          setConnection("error");
          setError("The live connection ended. Rejoin an open speaker spot or wait for the room to reconnect.");
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        if (!activeRef.current || roomRef.current !== room) return;
        roomRef.current = null;
        roleRef.current = null;
        setMedia({});
        setConnection("error");
        setError("The live connection ended. Rejoin an open speaker spot or wait for the room to reconnect.");
      });
      await room.connect(token.url, token.token, { autoSubscribe: false });
      if (!activeRef.current) {
        room.removeAllListeners();
        await room.disconnect();
        return;
      }
      refreshSubscriptions();
      refreshMedia();
      setConnection("connected");
      try {
        await room.startAudio();
        setPlaybackBlocked(false);
      } catch {
        setPlaybackBlocked(true);
      }
    } catch (failure) {
      if (activeRef.current) {
        if (errStatus(failure) === null) setConnection("error");
        else setConnection("idle");
        setError(safeBeamError(failure, "Live audio is temporarily unavailable. You can keep chatting and try again."));
      }
    } finally {
      startingRef.current = false;
    }
  }, [headers]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    syncAudioSubscriptions(
      room, beamRef.current, participantId, blockedParticipantIdsRef.current,
      roleRef.current === "speaker" && speakerReadyRef.current,
    );
  }, [blockedParticipantIds.join("|"), participantId]);

  useEffect(() => {
    activeRef.current = true;
    applyBeam(emptyState(roomId));
    clearRoom(true);
    setConnection("idle");
    setError(null);
    if (!roomSessionId || !participantId) {
      activeRef.current = false;
      return;
    }
    let current = true;
    let refreshing = false;
    const args = { roomId, roomSessionId, participantId };
    const refresh = async () => {
      if (!current || refreshing || actionRef.current) return;
      refreshing = true;
      try {
        const state = await getUniversityVideoBeamState(roomId, {
          headers: headers(roomSessionId),
          credentials: "include",
        });
        if (!current) return;
        applyBeam(state);
        const ownSpeakerSlot = state.slots.some(slot => slot.participantId === participantId);
        if (state.beamActive && !ownSpeakerSlot && !roomRef.current && !startingRef.current) {
          void connectAsAudience(args);
        } else if (!state.beamActive && roleRef.current === "audience") {
          clearRoom(false);
          setConnection("idle");
        }
      } catch (failure) {
        if (current && (errStatus(failure) ?? 0) < 500) {
          setError(safeBeamError(failure, "Room video status is reconnecting."));
        }
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2_500);
    return () => {
      current = false;
      activeRef.current = false;
      window.clearInterval(timer);
      const oldRoom = roomRef.current;
      const oldRole = roleRef.current;
      roomRef.current = null;
      roleRef.current = null;
      if (oldRole === "speaker") {
        void doAction(args, { action: "leave-slot" }).catch(() => undefined);
      }
      if (oldRoom) {
        oldRoom.removeAllListeners();
        void oldRoom.disconnect();
      }
      stopTracks(tracksRef.current);
      tracksRef.current = [];
    };
  }, [roomId, roomSessionId, participantId, applyBeam, clearRoom, connectAsAudience, doAction, headers]);

  const refresh = useCallback(async () => {
    const args = latest.current;
    if (!args.roomSessionId) return;
    const state = await getUniversityVideoBeamState(args.roomId, {
      headers: headers(args.roomSessionId),
      credentials: "include",
    });
    applyBeam(state);
  }, [applyBeam, headers]);

  const joinSpeaker = useCallback(async () => {
    const args = latest.current;
    if (actionRef.current || !args.roomSessionId || !args.participantId) return;
    actionRef.current = true;
    setBusy(true);
    setError(null);
    let localTracks: LocalTrack[] = [];
    let room: Room | null = null;
    try {
      if (roleRef.current === "audience") clearRoom(false);
      const latestBeam = await getUniversityVideoBeamState(args.roomId, {
        headers: headers(args.roomSessionId),
        credentials: "include",
      });
      applyBeam(latestBeam);
      const alreadyOwnsSpot = latestBeam.slots.some(slot => slot.participantId === args.participantId);
      const available = alreadyOwnsSpot || latestBeam.slots.some(slot => !slot.participantId);
      if (!available) throw new Error("All eight speaker spots are full. You can still watch and chat.");
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser cannot access a microphone for live audio.");
      }

      // Reserve before the browser prompt, so two people cannot claim the same
      // last spot and a slow permission response cannot be mistaken for a leave.
      const reserved = await doAction(args, { action: "reserve-slot" });
      applyBeam(reserved);

      // Capture is requested only inside the explicit speaker-join click.
      localTracks = await createLocalTracks({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      tracksRef.current = localTracks;
      const token = await getUniversityVideoBeamToken(args.roomId, { role: "speaker" }, {
        headers: headers(args.roomSessionId),
        credentials: "include",
      });
      room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      roleRef.current = "speaker";
      speakerReadyRef.current = false;
      const refreshMedia = () => {
        const snapshot: MediaMap = {};
        for (const participant of room!.remoteParticipants.values()) {
          const entry: { audio?: RemoteTrack | LocalTrack } = {};
          for (const publication of participant.trackPublications.values()) {
            const track = publication.track;
            if (!track) continue;
            if (track.kind === Track.Kind.Audio && publication.source === Track.Source.Microphone) {
              entry.audio = track as RemoteTrack;
            }
          }
          snapshot[participant.identity] = entry;
        }
        setMedia(snapshot);
        setMediaVersion(version => version + 1);
      };
      const refreshSubscriptions = () => syncAudioSubscriptions(
        room!, beamRef.current, args.participantId, blockedParticipantIdsRef.current,
        roleRef.current === "speaker" && speakerReadyRef.current,
      );
      room.on(RoomEvent.ParticipantConnected, refreshSubscriptions);
      room.on(RoomEvent.TrackPublished, refreshSubscriptions);
      room.on(RoomEvent.TrackUnpublished, refreshMedia);
      room.on(RoomEvent.TrackSubscribed, refreshMedia);
      room.on(RoomEvent.TrackUnsubscribed, refreshMedia);
      room.on(RoomEvent.TrackMuted, refreshMedia);
      room.on(RoomEvent.TrackUnmuted, refreshMedia);
      room.on(RoomEvent.ParticipantDisconnected, refreshMedia);
      room.on(RoomEvent.ActiveSpeakersChanged, speakers => setSpeaking(new Set(speakers.map(person => person.identity))));
      room.on(RoomEvent.ConnectionStateChanged, state => {
        if (roomRef.current !== room) return;
        if (state === "connected") setConnection("connected");
        if (state === "reconnecting") setConnection("connecting");
      });
      room.on(RoomEvent.Disconnected, () => {
        if (!activeRef.current || roomRef.current !== room) return;
        roomRef.current = null;
        roleRef.current = null;
        speakerReadyRef.current = false;
        setMedia({});
        stopTracks(tracksRef.current);
        tracksRef.current = [];
        setConnection("error");
        setError("Your live connection ended. Your speaker spot was released; tap to rejoin.");
        void doAction(args, { action: "leave-slot" }).catch(() => undefined);
      });
      await room.connect(token.url, token.token, { autoSubscribe: false });
      // The server grants publishing and listening only after validating the
      // speaker's current seat and microphone state.
      const state = await doAction(args, { action: "speaker-connected" });
      applyBeam(state);
      speakerReadyRef.current = true;
      refreshSubscriptions();
      refreshMedia();
      setConnection("connected");
      try {
        await room.startAudio();
        setPlaybackBlocked(false);
      } catch {
        setPlaybackBlocked(true);
      }
    } catch (failure) {
      if (room) {
        room.removeAllListeners();
        await room.disconnect().catch(() => undefined);
      }
      if (roomRef.current === room) {
        roomRef.current = null;
        roleRef.current = null;
      }
      speakerReadyRef.current = false;
      stopTracks(localTracks);
      tracksRef.current = [];
      const failureName = (failure as { name?: string } | null)?.name;
      const permissionFailure = ["NotAllowedError", "SecurityError", "NotFoundError", "OverconstrainedError"]
        .includes(failureName ?? "");
      if (!permissionFailure && errStatus(failure) === null) setConnection("error");
      else setConnection("idle");
      setError(safeBeamError(failure, "Could not start live audio. You remain in the room."));
      try {
        await doAction(args, { action: "leave-slot" });
      } catch { /* the server may already have released a failed reservation */ }
    } finally {
      actionRef.current = false;
      setBusy(false);
      try { await refresh(); } catch { /* polling reports the next failure */ }
    }
  }, [applyBeam, clearRoom, doAction, headers, refresh]);

  const runAction = useCallback(async (data: UniversityVideoBeamActionInput) => {
    const args = latest.current;
    if (actionRef.current || !args.roomSessionId) return false;
    actionRef.current = true;
    setBusy(true);
    setError(null);
    let succeeded = false;
    try {
      const state = await doAction(args, data);
      applyBeam(state);
      succeeded = true;
      if (data.action === "leave-slot") {
        const room = roomRef.current;
        roomRef.current = null;
        roleRef.current = null;
        speakerReadyRef.current = false;
        if (room) { room.removeAllListeners(); await room.disconnect(); }
        stopTracks(tracksRef.current);
        tracksRef.current = [];
        setMedia({});
        setSpeaking(new Set());
        setConnection("idle");
      }
    } catch (failure) {
      setError(safeBeamError(failure, "That video beam action did not complete."));
    } finally {
      actionRef.current = false;
      setBusy(false);
      try { await refresh(); } catch { /* next scheduled refresh will retry */ }
    }
    return succeeded;
  }, [applyBeam, doAction, refresh]);

  const ownSlot = beam.slots.find(slot => slot.participantId === participantId);
  useEffect(() => {
    const room = roomRef.current;
    if (!room || roleRef.current !== "speaker" || !speakerReadyRef.current || connection !== "connected"
      || !ownSlot || ownSlot.participantId !== participantId) return;
    const microphoneShouldBeEnabled = !ownSlot.micMuted && !ownSlot.mutedByHost;
    let active = true;
    void (async () => {
      try {
        const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        const unpublishedTrack = tracksRef.current.find(track => track.kind === Track.Kind.Audio);
        if (!microphoneShouldBeEnabled) {
          if (publication?.track) await publication.track.mute();
          else if (unpublishedTrack) await unpublishedTrack.mute();
          return;
        }
        if (publication?.track) {
          await publication.track.unmute();
        } else if (unpublishedTrack) {
          await room.localParticipant.publishTrack(unpublishedTrack);
          await unpublishedTrack.unmute();
        } else {
          // A speaker can enable their mic after joining with it muted.
          await room.localParticipant.setMicrophoneEnabled(true);
        }
      } catch (failure) {
        if (!active) return;
        setError(errMessage(failure, "Microphone access is unavailable. Check your browser permission and try again."));
        if (microphoneShouldBeEnabled) {
          void doAction(latest.current, { action: "set-self-mic", enabled: false })
            .then(applyBeam)
            .catch(() => undefined);
        }
      }
    })();
    return () => { active = false; };
  }, [
    applyBeam,
    connection,
    doAction,
    ownSlot?.micMuted,
    ownSlot?.mutedByHost,
    ownSlot?.participantId,
    participantId,
  ]);

  const toggleMic = useCallback((enabled: boolean) => runAction({ action: "set-self-mic", enabled }), [runAction]);
  const hostMuteMic = useCallback((targetParticipantId: string) =>
    runAction({ action: "host-mute-mic", targetParticipantId }), [runAction]);
  const kick = useCallback((targetParticipantId: string) =>
    runAction({ action: "kick", targetParticipantId }), [runAction]);

  const resumePlayback = useCallback(async () => {
    try {
      await roomRef.current?.startAudio();
      setPlaybackBlocked(false);
    } catch {
      setPlaybackBlocked(true);
      setError("Tap again to allow room audio in this browser.");
    }
  }, []);

  const isHost = beam.hostParticipantId === participantId && !!ownSlot;

  return {
    beam,
    connection,
    busy,
    error,
    playbackBlocked,
    speaking,
    media,
    mediaVersion,
    ownSlot,
    isHost,
    joinSpeaker,
    leaveSlot: () => runAction({ action: "leave-slot" }),
    moveToSlot: (targetSlotNumber: number) => runAction({ action: "move-slot", targetSlotNumber }),
    toggleMic,
    hostMuteMic,
    kick,
    searchTv,
    reportTvPlaybackFailure,
    resumePlayback,
    refresh,
  };
}

export function BeamAudioTrack({ track }: { track?: RemoteTrack | LocalTrack }) {
  const elementRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const element = elementRef.current;
    if (!element || !track) return;
    const attached = track.attach(element) as HTMLAudioElement;
    attached.autoplay = true;
    void attached.play().catch(() => undefined);
    return () => { track.detach(element); };
  }, [track]);
  if (!track) return null;
  return createElement("audio", {
    ref: elementRef as RefObject<HTMLAudioElement>,
    autoPlay: true,
  });
}
