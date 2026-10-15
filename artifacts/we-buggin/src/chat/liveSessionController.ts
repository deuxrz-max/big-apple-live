import {
  Room, RoomEvent, Track, createLocalTracks,
  type LocalTrack, type RemoteTrack,
} from "livekit-client";
import {
  endLiveStream, getLiveStreams, joinLiveStream, rejoinLiveStream, startLiveStream,
} from "@workspace/api-client-react";

type HostSession = Awaited<ReturnType<typeof startLiveStream>>;
type ViewerSession = Awaited<ReturnType<typeof joinLiveStream>>;
type Phase =
  | "idle" | "requesting-camera" | "starting-server" | "connecting"
  | "live" | "camera-error" | "server-error" | "conflict"
  | "livekit-error" | "ending" | "ended";

export type HostLiveSnapshot = {
  phase: Phase;
  session: HostSession | null;
  localStream: MediaStream | null;
  localTracks: LocalTrack[];
  videoTrack: LocalTrack | null;
  room: Room | null;
  viewerCount: number;
  chatReady: boolean;
  microphoneEnabled: boolean;
  cameraFacing: "user" | "environment";
  error: string;
  conflictStreamId: string | null;
  joinNotice: string;
};

export type ViewerLiveSnapshot = {
  phase: "idle" | "connecting" | "live" | "error" | "ended";
  session: ViewerSession | null;
  room: Room | null;
  videoTrack: RemoteTrack | null;
  audioTrack: RemoteTrack | null;
  viewerCount: number;
  audioEnabled: boolean;
  error: string;
  joinNotice: string;
};

const emptyHostSnapshot = (): HostLiveSnapshot => ({
  phase: "idle",
  session: null,
  localStream: null,
  localTracks: [],
  videoTrack: null,
  room: null,
  viewerCount: 0,
  chatReady: false,
  microphoneEnabled: true,
  cameraFacing: "user",
  error: "",
  conflictStreamId: null,
  joinNotice: "",
});

const emptyViewerSnapshot = (): ViewerLiveSnapshot => ({
  phase: "idle",
  session: null,
  room: null,
  videoTrack: null,
  audioTrack: null,
  viewerCount: 0,
  audioEnabled: false,
  error: "",
  joinNotice: "",
});

function httpStatus(error: unknown): number {
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status) || 0
    : 0;
}

export function cameraFailureMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return "This browser cannot access the camera. Open Streamtalk in Chrome or Brave and allow camera access.";
  }
  if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(name)) {
    return "Camera or microphone permission was denied. Allow access in browser settings, then try again.";
  }
  if (["NotFoundError", "DevicesNotFoundError"].includes(name)) {
    return "No camera was found on this device.";
  }
  if (["NotReadableError", "TrackStartError", "AbortError"].includes(name)) {
    return "The camera may be in use by another app. Close that app and try again.";
  }
  return "The camera could not start. Check its permission and try again.";
}

async function acquireForgivingTracks(): Promise<LocalTrack[]> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    const unavailable = new Error("Camera API unavailable");
    unavailable.name = "CameraUnavailableError";
    throw unavailable;
  }

  const attempts = [
    {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: { facingMode: "user" },
    },
    { audio: true, video: true },
    { audio: false, video: true },
  ] as const;
  let lastError: unknown;

  for (const options of attempts) {
    let tracks: LocalTrack[] = [];
    try {
      tracks = await createLocalTracks(options);
      if (tracks.some(track => track.kind === Track.Kind.Video)) return tracks;
      lastError = new Error("The device did not provide a camera track.");
    } catch (error) {
      lastError = error;
    }
    for (const track of tracks) track.stop();
  }
  throw lastError ?? new Error("No camera track was created.");
}

function localStreamFor(tracks: LocalTrack[]): MediaStream | null {
  const video = tracks.find(track => track.kind === Track.Kind.Video);
  return video ? new MediaStream([video.mediaStreamTrack]) : null;
}

const liveApiUrl = (path: string) =>
  `${import.meta.env.BASE_URL}api/account/live-streams/${encodeURIComponent(path)}`;

class HostLiveSessionController {
  private snapshot = emptyHostSnapshot();
  private listeners = new Set<() => void>();
  private generation = 0;
  private heartbeatTimer: number | undefined;
  private joinNoticeTimer: number | undefined;
  private pagehideInstalled = false;
  private endPromise: Promise<void> | null = null;

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(patch: Partial<HostLiveSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private installPagehide() {
    if (this.pagehideInstalled) return;
    this.pagehideInstalled = true;
    window.addEventListener("pagehide", this.handlePagehide);
  }

  private removePagehide() {
    if (!this.pagehideInstalled) return;
    this.pagehideInstalled = false;
    window.removeEventListener("pagehide", this.handlePagehide);
  }

  private handlePagehide = () => {
    const session = this.snapshot.session;
    if (session) {
      const url = `${liveApiUrl(session.streamId)}/end`;
      try {
        const sent = navigator.sendBeacon(url, new Blob(["{}"], { type: "application/json" }));
        if (!sent) {
          void fetch(url, {
            method: "POST", credentials: "include", keepalive: true,
            headers: { "Content-Type": "application/json" }, body: "{}",
          }).catch(() => undefined);
        }
      } catch {
        // The server's heartbeat timeout remains the fallback.
      }
    }
    this.releaseLocalMedia();
  };

  private releaseLocalMedia() {
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    const room = this.snapshot.room;
    this.snapshot.localTracks.forEach(track => track.stop());
    if (room) void room.disconnect();
    this.update({ room: null, localStream: null, localTracks: [], videoTrack: null });
  }

  private async ensureCamera(generation: number): Promise<boolean> {
    if (this.snapshot.localStream && this.snapshot.localTracks.length) return true;
    this.update({ phase: "requesting-camera", error: "", conflictStreamId: null });
    try {
      const tracks = await acquireForgivingTracks();
      if (generation !== this.generation) {
        tracks.forEach(track => track.stop());
        return false;
      }
      const stream = localStreamFor(tracks);
      if (!stream) {
        tracks.forEach(track => track.stop());
        throw new Error("No camera track was created.");
      }
      this.update({
        localTracks: tracks,
        localStream: stream,
        videoTrack: tracks.find(track => track.kind === Track.Kind.Video) ?? null,
        microphoneEnabled: tracks.some(track => track.kind === Track.Kind.Audio),
        phase: "starting-server",
        error: "",
      });
      return true;
    } catch (error) {
      if (generation === this.generation) {
        this.update({ phase: "camera-error", error: cameraFailureMessage(error) });
      }
      return false;
    }
  }

  async start(username: string, replaceExisting = false) {
    if (["requesting-camera", "starting-server", "connecting", "live", "ending"].includes(this.snapshot.phase)) return;
    const generation = ++this.generation;
    this.endPromise = null;
    this.installPagehide();
    this.update({ phase: "requesting-camera", error: "", conflictStreamId: null });
    if (!(await this.ensureCamera(generation)) || generation !== this.generation) return;
    await this.startServerSession(username, replaceExisting, generation);
  }

  async resume(streamId: string) {
    if (["requesting-camera", "starting-server", "connecting", "live", "ending"].includes(this.snapshot.phase)) return;
    const generation = ++this.generation;
    this.installPagehide();
    this.update({ phase: "requesting-camera", error: "", conflictStreamId: null });
    if (!(await this.ensureCamera(generation)) || generation !== this.generation) return;
    this.update({ phase: "starting-server", error: "Reconnecting to your previous stream…" });
    try {
      const session = await rejoinLiveStream(streamId, { credentials: "include" });
      if (generation !== this.generation) {
        await endLiveStream(session.streamId, { credentials: "include" }).catch(() => undefined);
        return;
      }
      this.update({ session, error: "", phase: "connecting" });
      await this.connectAndPublish(session, generation);
    } catch (error) {
      if (generation === this.generation) {
        const status = httpStatus(error);
        this.update({
          phase: "server-error",
          error: status === 404
            ? "That stream has ended. Start a new one instead."
            : "Could not reconnect to the previous stream. Try starting a new one.",
        });
      }
    }
  }

  async startFresh(username: string) {
    if (this.snapshot.phase === "ending") return;
    const generation = ++this.generation;
    this.installPagehide();
    this.update({ phase: "starting-server", error: "", conflictStreamId: null });
    if (!(await this.ensureCamera(generation)) || generation !== this.generation) return;
    await this.startServerSession(username, true, generation);
  }

  private async startServerSession(username: string, replaceExisting: boolean, generation: number) {
    try {
      const session = await startLiveStream({ replaceExisting }, { credentials: "include" });
      if (generation !== this.generation) {
        await endLiveStream(session.streamId, { credentials: "include" }).catch(() => undefined);
        return;
      }
      this.update({ session, phase: "connecting", error: "" });
      await this.connectAndPublish(session, generation);
    } catch (error) {
      if (generation !== this.generation) return;
      const status = httpStatus(error);
      if (status === 409 && !replaceExisting) {
        let conflictStreamId: string | null = null;
        try {
          const result = await getLiveStreams({ credentials: "include" });
          conflictStreamId = result.streams.find(stream => stream.username.toLowerCase() === username.toLowerCase())?.streamId ?? null;
        } catch {
          // Still show the safe "end old and start fresh" option.
        }
        this.update({
          phase: "conflict",
          conflictStreamId,
          error: "A stream may still be active on another device.",
        });
        return;
      }
      this.update({
        phase: "server-error",
        error: status === 401
          ? "Please sign in again before going live."
          : status === 403
            ? "Finish your profile setup before going live."
            : status === 503
              ? "Live video is temporarily unavailable. Try again soon."
              : "The stream could not be started. Your camera preview is still available.",
      });
    }
  }

  private async confirmHeartbeat(streamId: string, generation: number) {
    const url = `${liveApiUrl(streamId)}/heartbeat`;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (generation !== this.generation) return false;
      try {
        const response = await fetch(url, {
          method: "POST", credentials: "include", cache: "no-store",
          headers: { "Content-Type": "application/json" }, body: "{}",
        });
        if (response.ok) return true;
        if (response.status === 404) return false;
      } catch {
        // Retry briefly before exposing a connection state to the user.
      }
      if (attempt < 3) await new Promise(resolve => window.setTimeout(resolve, 250 + attempt * 250));
    }
    return false;
  }

  private async connectAndPublish(session: HostSession, generation: number) {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.update({ room, phase: "connecting", viewerCount: 0 });
    room.on(RoomEvent.ParticipantConnected, () => {
      if (generation !== this.generation) return;
      this.update({ viewerCount: room.remoteParticipants.size });
      const participant = [...room.remoteParticipants.values()].at(-1);
      if (participant && participant.identity !== "host") {
        this.update({ joinNotice: participant.name?.trim() || "Someone" });
        if (this.joinNoticeTimer) window.clearTimeout(this.joinNoticeTimer);
        this.joinNoticeTimer = window.setTimeout(() => this.update({ joinNotice: "" }), 2800);
      }
    });
    room.on(RoomEvent.ParticipantDisconnected, () => {
      if (generation === this.generation) this.update({ viewerCount: room.remoteParticipants.size });
    });
    room.on(RoomEvent.ConnectionStateChanged, state => {
      if (generation !== this.generation) return;
      if (state === "reconnecting") this.update({ phase: "livekit-error", error: "Live connection interrupted. Your camera preview remains on." });
      if (state === "connected" && this.snapshot.chatReady) this.update({ phase: "live", error: "" });
    });
    room.on(RoomEvent.Disconnected, () => {
      if (generation !== this.generation) return;
      this.update({
        room: null,
        phase: "livekit-error",
        error: "LiveKit disconnected. Your camera preview remains on; tap Retry connection.",
      });
    });

    try {
      await room.connect(session.url, session.token);
      if (generation !== this.generation) {
        await room.disconnect();
        return;
      }
      for (const track of this.snapshot.localTracks) {
        if (track.mediaStreamTrack.readyState !== "ended") await room.localParticipant.publishTrack(track);
      }
      if (generation !== this.generation) {
        await room.disconnect();
        return;
      }
      const confirmed = await this.confirmHeartbeat(session.streamId, generation);
      if (!confirmed) throw new Error("The server did not confirm the live session.");
      if (generation !== this.generation) {
        await room.disconnect();
        return;
      }
      this.update({ chatReady: true, phase: "live", error: "", viewerCount: room.remoteParticipants.size });
      this.heartbeatTimer = window.setInterval(() => void this.heartbeat(session.streamId, generation), 10_000);
    } catch {
      if (generation !== this.generation) return;
      await room.disconnect().catch(() => undefined);
      if (this.joinNoticeTimer) window.clearTimeout(this.joinNoticeTimer);
      if (this.snapshot.room === room) {
        this.update({
          room: null,
          phase: "livekit-error",
          error: "LiveKit could not connect. Your local camera preview remains on. Tap Retry connection.",
        });
      }
    }
  }

  private async heartbeat(streamId: string, generation: number) {
    try {
      const response = await fetch(`${liveApiUrl(streamId)}/heartbeat`, {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (response.status === 404 && generation === this.generation) {
        this.update({ phase: "ended", chatReady: false, error: "This stream has ended." });
        this.releaseLocalMedia();
      }
    } catch {
      // The next heartbeat retries; the server's lease cleanup remains authoritative.
    }
  }

  async retryConnection(username: string) {
    if (this.snapshot.phase === "livekit-error" && this.snapshot.session) {
      await this.startFresh(username);
    } else {
      await this.start(username);
    }
  }

  async flipCamera() {
    const track = this.snapshot.localTracks.find(item => item.kind === Track.Kind.Video) as
      (LocalTrack & { restartTrack?: (options: { facingMode: string }) => Promise<void> }) | undefined;
    if (!track?.restartTrack) {
      this.update({ error: "This camera cannot be switched." });
      return;
    }
    const next = this.snapshot.cameraFacing === "user" ? "environment" : "user";
    try {
      await track.restartTrack({ facingMode: next });
      const stream = localStreamFor(this.snapshot.localTracks);
      this.update({ cameraFacing: next, localStream: stream, videoTrack: track, error: "" });
    } catch {
      this.update({ error: "The camera could not be switched." });
    }
  }

  async retryCamera(username: string) {
    const oldVideo = this.snapshot.localTracks.find(track => track.kind === Track.Kind.Video);
    if (!oldVideo || oldVideo.mediaStreamTrack.readyState === "ended") {
      const sessionExists = Boolean(this.snapshot.session);
      const microphoneWasEnabled = this.snapshot.microphoneEnabled;
      const oldRoom = this.snapshot.room;
      if (oldRoom) await oldRoom.disconnect().catch(() => undefined);
      this.snapshot.localTracks.forEach(track => track.stop());
      this.update({ room: null, localTracks: [], localStream: null, videoTrack: null, phase: sessionExists ? "livekit-error" : "idle" });
      if (sessionExists) {
        await this.startFresh(username);
        if (!microphoneWasEnabled && this.snapshot.microphoneEnabled) await this.toggleMicrophone();
      } else await this.start(username);
      return;
    }
    this.update({ phase: this.snapshot.session ? "livekit-error" : "requesting-camera", error: "" });
    let replacement: LocalTrack | undefined;
    try {
      const acquired = await createLocalTracks({
        audio: false,
        video: { facingMode: this.snapshot.cameraFacing },
      });
      replacement = acquired.find(track => track.kind === Track.Kind.Video);
      for (const track of acquired) if (track !== replacement) track.stop();
      if (!replacement) throw new Error("No camera track was created.");
      const room = this.snapshot.room;
      if (room?.state === "connected") {
        await room.localParticipant.unpublishTrack(oldVideo);
        oldVideo.stop();
        await room.localParticipant.publishTrack(replacement);
      } else if (room) {
        await room.disconnect();
      }
      const tracks = [...this.snapshot.localTracks.filter(track => track !== oldVideo), replacement];
      this.update({
        localTracks: tracks,
        localStream: localStreamFor(tracks),
        videoTrack: replacement,
        room: room?.state === "connected" ? room : null,
        error: "",
      });
      if (this.snapshot.session && room?.state !== "connected") await this.startFresh(username);
    } catch (error) {
      replacement?.stop();
      this.update({ phase: this.snapshot.session ? "livekit-error" : "camera-error", error: cameraFailureMessage(error) });
    }
  }

  async toggleMicrophone() {
    const track = this.snapshot.localTracks.find(item => item.kind === Track.Kind.Audio);
    if (!track) {
      this.update({ error: "No microphone is available. Your camera stream can continue without it." });
      return;
    }
    try {
      if (this.snapshot.microphoneEnabled) await track.mute();
      else await track.unmute();
      this.update({ microphoneEnabled: !this.snapshot.microphoneEnabled, error: "" });
    } catch {
      this.update({ error: "The microphone could not be updated." });
    }
  }

  async end() {
    if (this.endPromise) return this.endPromise;
    const generation = ++this.generation;
    const session = this.snapshot.session;
    const room = this.snapshot.room;
    const tracks = [...this.snapshot.localTracks];
    this.update({ phase: "ending", chatReady: false });
    this.removePagehide();
    this.endPromise = (async () => {
      const disconnect = room ? Promise.all([
        ...tracks.map(track => room.localParticipant.unpublishTrack(track).catch(() => undefined)),
        room.disconnect().catch(() => undefined),
      ]) : Promise.resolve();
      tracks.forEach(track => track.stop());
      if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
      const serverEnd = session
        ? endLiveStream(session.streamId, { credentials: "include" }).catch(() => undefined)
        : Promise.resolve();
      // A slow end request must never keep the camera running or strand the UI.
      await Promise.race([
        Promise.all([disconnect, serverEnd]),
        new Promise<void>(resolve => window.setTimeout(resolve, 2500)),
      ]);
      if (generation !== this.generation) return;
      this.update({ ...emptyHostSnapshot(), phase: "ended" });
      this.endPromise = null;
    })();
    return this.endPromise;
  }
}

class ViewerLiveSessionController {
  private snapshot = emptyViewerSnapshot();
  private listeners = new Set<() => void>();
  private room: Room | null = null;
  private generation = 0;
  private joinNoticeTimer: number | undefined;

  constructor(private readonly streamId: string) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(patch: Partial<ViewerLiveSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  async connect() {
    if (this.snapshot.phase === "connecting" || this.snapshot.phase === "live") return;
    const generation = ++this.generation;
    this.update({ ...emptyViewerSnapshot(), phase: "connecting" });
    let room: Room | null = null;
    try {
      const session = await joinLiveStream(this.streamId, { credentials: "include" });
      if (generation !== this.generation) return;
      room = new Room({ adaptiveStream: true, dynacast: true });
      this.room = room;
      this.update({ session, room, phase: "connecting" });
      const refresh = () => {
        if (generation !== this.generation || !room) return;
        let videoTrack: RemoteTrack | null = null;
        let audioTrack: RemoteTrack | null = null;
        for (const participant of room.remoteParticipants.values()) {
          if (participant.identity !== "host") continue;
          for (const publication of participant.trackPublications.values()) {
            if (!publication.track) continue;
            if (publication.kind === Track.Kind.Video) videoTrack = publication.track as RemoteTrack;
            if (publication.kind === Track.Kind.Audio) audioTrack = publication.track as RemoteTrack;
          }
        }
        this.update({ videoTrack, audioTrack, viewerCount: room.remoteParticipants.size + 1 });
      };
      room.on(RoomEvent.TrackSubscribed, refresh);
      room.on(RoomEvent.TrackUnsubscribed, refresh);
      room.on(RoomEvent.ParticipantConnected, refresh);
      room.on(RoomEvent.ParticipantConnected, participant => {
        if (generation !== this.generation || participant.identity === "host") return;
        this.update({ joinNotice: participant.name?.trim() || "Someone" });
        if (this.joinNoticeTimer) window.clearTimeout(this.joinNoticeTimer);
        this.joinNoticeTimer = window.setTimeout(() => this.update({ joinNotice: "" }), 2800);
      });
      room.on(RoomEvent.ParticipantDisconnected, refresh);
      room.on(RoomEvent.ConnectionStateChanged, state => {
        if (generation === this.generation && state === "reconnecting") {
          this.update({ phase: "error", error: "The stream connection is reconnecting…" });
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        if (generation === this.generation) {
          this.update({ room: null, phase: "error", error: "The stream connection was interrupted. Try again." });
        }
      });
      await room.connect(session.url, session.token);
      if (generation !== this.generation) {
        await room.disconnect();
        return;
      }
      refresh();
      this.update({ phase: "live", error: "" });
      try {
        await room.startAudio();
        this.update({ audioEnabled: true });
      } catch {
        this.update({ audioEnabled: false });
      }
    } catch (error) {
      if (generation === this.generation) {
        if (room) await room.disconnect().catch(() => undefined);
        this.room = null;
        const status = httpStatus(error);
        this.update({
          room: null,
          phase: "error",
          error: status === 404
            ? "This stream has ended or is not available."
            : "Could not connect to this live stream. Try again.",
        });
      }
    }
  }

  async enableAudio() {
    try {
      await this.room?.startAudio();
      this.update({ audioEnabled: true, error: "" });
    } catch {
      this.update({ error: "Tap again to enable the stream audio." });
    }
  }

  async retry() {
    await this.leave(false);
    await this.connect();
  }

  async leave(markEnded = true) {
    ++this.generation;
    if (this.joinNoticeTimer) window.clearTimeout(this.joinNoticeTimer);
    const room = this.room;
    this.room = null;
    if (room) await room.disconnect().catch(() => undefined);
    this.update({ ...emptyViewerSnapshot(), phase: markEnded ? "ended" : "idle" });
  }
}

export const hostLiveSession = new HostLiveSessionController();
const viewerSessions = new Map<string, ViewerLiveSessionController>();

export function viewerLiveSession(streamId: string) {
  let controller = viewerSessions.get(streamId);
  if (!controller) {
    controller = new ViewerLiveSessionController(streamId);
    viewerSessions.set(streamId, controller);
  }
  return controller;
}

export function leaveViewerLiveSession(streamId: string) {
  const controller = viewerSessions.get(streamId);
  if (controller) {
    viewerSessions.delete(streamId);
    void controller.leave();
  }
}

export function endHostLiveSessionForRouteChange() {
  if (hostLiveSession.getSnapshot().phase !== "idle" && hostLiveSession.getSnapshot().phase !== "ended") {
    void hostLiveSession.end();
  }
}
