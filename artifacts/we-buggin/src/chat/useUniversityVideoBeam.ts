import { createElement, useCallback, useEffect, useRef, useState } from "react";
import {
  getUniversityVideoBeamState,
  getUniversityVideoBeamToken,
  performUniversityVideoBeamAction,
  type UniversityVideoBeamActionInput,
  type UniversityVideoBeamState,
} from "@workspace/api-client-react";
import {
  createLocalTracks,
  Room,
  RoomEvent,
  Track,
  type LocalTrack,
  type LocalVideoTrack,
  type RemoteTrack,
} from "livekit-client";
import { errMessage } from "@/lib/errors";
import type { RefObject } from "react";

type BeamConnection = "idle" | "connecting" | "connected" | "error";
type MediaMap = Record<string, { audio?: RemoteTrack | LocalTrack; video?: RemoteTrack | LocalTrack }>;

const emptyState = (roomId: string): UniversityVideoBeamState => ({
  roomId,
  beamActive: false,
  hostParticipantId: null,
  slots: [1, 2, 3, 4].map(slotNumber => ({
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

export function useUniversityVideoBeam(
  roomId: string,
  roomSessionId: string,
  participantId: string,
) {
  const [beam, setBeam] = useState(() => emptyState(roomId));
  const [connection, setConnection] = useState<BeamConnection>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [media, setMedia] = useState<MediaMap>({});
  const [mediaVersion, setMediaVersion] = useState(0);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const roomRef = useRef<Room | null>(null);
  const roleRef = useRef<"audience" | "speaker" | null>(null);
  const tracksRef = useRef<LocalTrack[]>([]);
  const activeRef = useRef(false);
  const startingRef = useRef(false);
  const actionRef = useRef(false);
  const latest = useRef({ roomId, roomSessionId, participantId });
  const beamRef = useRef(beam);
  latest.current = { roomId, roomSessionId, participantId };
  beamRef.current = beam;

  const headers = useCallback((session: string) => ({ "X-Room-Session": session }), []);

  const applyBeam = useCallback((next: UniversityVideoBeamState) => {
    beamRef.current = next;
    setBeam(next);
  }, []);

  const doAction = useCallback(async (
    args: { roomId: string; roomSessionId: string },
    data: UniversityVideoBeamActionInput,
  ) => performUniversityVideoBeamAction(args.roomId, data, {
    headers: headers(args.roomSessionId),
    credentials: "include",
  }), [headers]);

  const clearRoom = useCallback((stopLocal: boolean) => {
    const room = roomRef.current;
    roomRef.current = null;
    roleRef.current = null;
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
          const entry: { audio?: RemoteTrack | LocalTrack; video?: RemoteTrack | LocalTrack } = {};
          for (const publication of participant.trackPublications.values()) {
            const track = publication.track;
            if (!track) continue;
            if (track.kind === Track.Kind.Video) entry.video = track as RemoteTrack;
            if (track.kind === Track.Kind.Audio) entry.audio = track as RemoteTrack;
          }
          snapshot[participant.identity] = entry;
        }
        setMedia(snapshot);
        setMediaVersion(version => version + 1);
      };
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
      await room.connect(token.url, token.token, { autoSubscribe: true });
      if (!activeRef.current) {
        room.removeAllListeners();
        await room.disconnect();
        return;
      }
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
        setConnection("error");
        setError(errMessage(failure, "Could not connect to live video. You can keep chatting and try again."));
      }
    } finally {
      startingRef.current = false;
    }
  }, [headers]);

  useEffect(() => {
    activeRef.current = true;
    applyBeam(emptyState(roomId));
    clearRoom(true);
    setConnection("idle");
    setError(null);
    setFacingMode("user");
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
        if (current) {
          setConnection("error");
          setError(errMessage(failure, "Could not load the video beam."));
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
      const latestBeam = await getUniversityVideoBeamState(args.roomId, {
        headers: headers(args.roomSessionId),
        credentials: "include",
      });
      applyBeam(latestBeam);
      const alreadyOwnsSpot = latestBeam.slots.some(slot => slot.participantId === args.participantId);
      const available = alreadyOwnsSpot || latestBeam.slots.some(slot => !slot.participantId);
      if (!available) throw new Error("All four speaker spots are full. You can still watch and chat.");
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser cannot access a camera and microphone for live video.");
      }

      // Reserve before the browser prompt, so two people cannot claim the same
      // last spot and a slow permission response cannot be mistaken for a leave.
      const reserved = await doAction(args, { action: "reserve-slot" });
      applyBeam(reserved);

      // Capture is requested only inside the explicit speaker-join click.
      localTracks = await createLocalTracks({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { facingMode: "user", resolution: { width: 640, height: 360 }, frameRate: 24 },
      });
      tracksRef.current = localTracks;
      const token = await getUniversityVideoBeamToken(args.roomId, { role: "speaker" }, {
        headers: headers(args.roomSessionId),
        credentials: "include",
      });
      room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      roleRef.current = "speaker";
      const refreshMedia = () => {
        const snapshot: MediaMap = {};
        for (const participant of room!.remoteParticipants.values()) {
          const entry: { audio?: RemoteTrack | LocalTrack; video?: RemoteTrack | LocalTrack } = {};
          for (const publication of participant.trackPublications.values()) {
            const track = publication.track;
            if (!track) continue;
            if (track.kind === Track.Kind.Video) entry.video = track as RemoteTrack;
            if (track.kind === Track.Kind.Audio) entry.audio = track as RemoteTrack;
          }
          snapshot[participant.identity] = entry;
        }
        const self: { audio?: RemoteTrack | LocalTrack; video?: RemoteTrack | LocalTrack } = {};
        for (const publication of room!.localParticipant.trackPublications.values()) {
          const track = publication.track;
          if (!track) continue;
          if (track.kind === Track.Kind.Video) self.video = track as LocalTrack;
          if (track.kind === Track.Kind.Audio) self.audio = track as LocalTrack;
        }
        snapshot[args.participantId] = self;
        setMedia(snapshot);
        setMediaVersion(version => version + 1);
      };
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
        setMedia({});
        stopTracks(tracksRef.current);
        tracksRef.current = [];
        setConnection("error");
        setError("Your live connection ended. Your speaker spot was released; tap to rejoin.");
        void doAction(args, { action: "leave-slot" }).catch(() => undefined);
      });
      await room.connect(token.url, token.token, { autoSubscribe: true });
      for (const track of localTracks) await room.localParticipant.publishTrack(track);
      const state = await doAction(args, { action: "speaker-connected" });
      applyBeam(state);
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
      stopTracks(localTracks);
      tracksRef.current = [];
      setConnection("error");
      setError(errMessage(failure, "Could not start the live camera and microphone. You remain in the room."));
      try {
        await doAction(args, { action: "leave-slot" });
      } catch { /* the server may already have released a failed reservation */ }
    } finally {
      actionRef.current = false;
      setBusy(false);
      try { await refresh(); } catch { /* polling reports the next failure */ }
    }
  }, [applyBeam, doAction, headers, refresh]);

  const runAction = useCallback(async (data: UniversityVideoBeamActionInput) => {
    const args = latest.current;
    if (actionRef.current || !args.roomSessionId) return;
    actionRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const state = await doAction(args, data);
      applyBeam(state);
      if (data.action === "set-self-mic" || data.action === "set-self-camera") {
        const source = data.action === "set-self-mic" ? Track.Source.Microphone : Track.Source.Camera;
        const publication = roomRef.current?.localParticipant.getTrackPublication(source);
        if (publication?.track) {
          if (data.enabled) await publication.track.unmute();
          else await publication.track.mute();
        }
      }
      if (data.action === "leave-slot") {
        const room = roomRef.current;
        roomRef.current = null;
        roleRef.current = null;
        if (room) { room.removeAllListeners(); await room.disconnect(); }
        stopTracks(tracksRef.current);
        tracksRef.current = [];
        setMedia({});
        setSpeaking(new Set());
        setConnection("idle");
      }
    } catch (failure) {
      setError(errMessage(failure, "That video beam action did not complete."));
    } finally {
      actionRef.current = false;
      setBusy(false);
      try { await refresh(); } catch { /* next scheduled refresh will retry */ }
    }
  }, [applyBeam, doAction, refresh]);

  const toggleMic = useCallback((enabled: boolean) => runAction({ action: "set-self-mic", enabled }), [runAction]);
  const toggleCamera = useCallback((enabled: boolean) => runAction({ action: "set-self-camera", enabled }), [runAction]);
  const hostMuteMic = useCallback((targetParticipantId: string) =>
    runAction({ action: "host-mute-mic", targetParticipantId }), [runAction]);
  const hostDisableCamera = useCallback((targetParticipantId: string) =>
    runAction({ action: "host-disable-camera", targetParticipantId }), [runAction]);
  const kick = useCallback((targetParticipantId: string) =>
    runAction({ action: "kick", targetParticipantId }), [runAction]);

  const flipCamera = useCallback(async () => {
    const track = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    if (!track || !("restartTrack" in track)) return;
    const next = facingMode === "user" ? "environment" : "user";
    try {
      await (track as LocalVideoTrack).restartTrack({ facingMode: next });
      setFacingMode(next);
      setError(null);
    } catch (failure) {
      setError(errMessage(failure, "Could not switch cameras on this device."));
    }
  }, [facingMode]);

  const resumePlayback = useCallback(async () => {
    try {
      await roomRef.current?.startAudio();
      setPlaybackBlocked(false);
    } catch {
      setPlaybackBlocked(true);
      setError("Tap again to allow room audio in this browser.");
    }
  }, []);

  const ownSlot = beam.slots.find(slot => slot.participantId === participantId);
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
    toggleMic,
    toggleCamera,
    flipCamera,
    hostMuteMic,
    hostDisableCamera,
    kick,
    resumePlayback,
    refresh,
  };
}

export function VideoBeamMedia({ track, kind, muted = false }: {
  track?: RemoteTrack | LocalTrack;
  kind: "audio" | "video";
  muted?: boolean;
}) {
  const elementRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  useEffect(() => {
    const element = elementRef.current;
    if (!element || !track) return;
    const attached = track.attach(element) as HTMLVideoElement | HTMLAudioElement;
    if ("playsInline" in attached) attached.playsInline = true;
    attached.autoplay = true;
    attached.muted = muted;
    void attached.play().catch(() => undefined);
    return () => { track.detach(element); };
  }, [track, muted]);
  if (!track) return null;
  return kind === "video"
    ? createElement("video", {
      ref: elementRef as RefObject<HTMLVideoElement>,
      className: "ur-live-video",
      autoPlay: true,
      playsInline: true,
      muted,
      "aria-label": muted ? "Your camera preview" : "Participant camera",
    })
    : createElement("audio", {
      ref: elementRef as RefObject<HTMLAudioElement>,
      autoPlay: true,
    });
}
