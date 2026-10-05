import { readAudioEvents } from "./events";
import { AudioConnection } from "./peer";
import { RoomAudioError, type AudioState, type AudioPeer, type AudioEvent } from "./protocol";

export interface RoomAudioOptions {
  roomId: string;
  participantSessionId: string;
  /** Same-origin API prefix, including the artifact's base path if applicable. */
  baseUrl?: string;
  /** Provide TURN here for restrictive NATs. An empty array disables public STUN. */
  iceServers?: RTCIceServer[];
  onState?(state: AudioState): void;
  onPeerState?(participantId: string, state: RTCPeerConnectionState): void;
  onError?(error: RoomAudioError): void;
}

/** Headless audio client for an existing participant session; creates no visible UI. */
export class RoomAudioClient {
  private active = false;
  private revision = 0;
  private stream?: MediaStream;
  private self?: AudioPeer;
  private readonly peers = new Map<string, AudioConnection>();
  private readonly allowedPeers = new Map<string, boolean>();
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private lifetime = new AbortController();
  private transport?: AbortController;
  private currentState: AudioState = "idle";
  private readonly roomUrl: string;

  constructor(private readonly options: RoomAudioOptions) {
    this.roomUrl = `${(options.baseUrl ?? "/api").replace(/\/$/, "")}/rooms/${encodeURIComponent(options.roomId)}`;
  }

  get state(): AudioState { return this.currentState; }

  /** Never expose a captured track until the participant explicitly enables it. */
  setMicrophoneEnabled(enabled: boolean): void {
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = enabled;
  }

  /** Apply the authoritative room roster to existing and future peer playback. */
  setPeerMicrophoneEnabled(participantId: string, enabled: boolean): void {
    this.allowedPeers.set(participantId, enabled);
    const peer = this.peers.get(participantId);
    if (peer) peer.audio.muted = !enabled;
  }

  /** Resolves once capture starts. Use state/peer callbacks to observe connectivity. */
  async start(): Promise<void> {
    if (this.active) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      const error = new RoomAudioError("unsupported", "WebRTC microphone audio requires a supported browser on HTTPS or localhost");
      this.fail(error);
      throw error;
    }
    const revision = ++this.revision;
    this.active = true;
    this.lifetime = new AbortController();
    this.setState("requesting-microphone");
    let captured: MediaStream;
    try {
      captured = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (cause) {
      if (!this.active || revision !== this.revision) return;
      const denied = cause instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(cause.name);
      const error = new RoomAudioError(
        denied ? "microphone-denied" : "microphone-unavailable",
        denied ? "Microphone permission was denied; enable it and call start again"
          : "Microphone is unavailable; check the input device and call start again",
      );
      this.fail(error);
      throw error;
    }
    if (!this.active || revision !== this.revision) {
      captured.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = captured;
    this.setMicrophoneEnabled(false);
    if (captured.getAudioTracks().length === 0) {
      const error = new RoomAudioError("microphone-unavailable", "Capture returned no audio input; check the input device and retry");
      this.fail(error);
      throw error;
    }
    for (const track of captured.getAudioTracks()) {
      track.onended = () => this.fail(new RoomAudioError("microphone-unavailable", "Microphone disconnected; choose an input device and restart audio"));
    }
    try {
      await this.heartbeat();
      if (!this.active || revision !== this.revision) return;
      // start() is the participant's explicit consent; host requests never call it.
      const response = await fetch(this.microphoneUrl(), {
        method: "PUT", headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unmute" }),
        signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(10_000)]),
      });
      if (response.status === 403) {
        throw new RoomAudioError("signaling-unavailable", "The room creator has muted your microphone");
      }
      await this.requireOk(response);
      if (!this.active || revision !== this.revision) return;
      // Initial audio.microphones event enables capture from the latest server state,
      // avoiding a stale unmute response overriding a concurrent host mute.
      this.heartbeatTimer = setInterval(() => {
        void this.heartbeat().catch((error: RoomAudioError) => {
          if (!this.active) return;
          if (error.code === "session-expired") this.fail(error);
          else this.options.onError?.(error);
        });
      }, 30_000);
      void this.runSignaling().catch(() => {
        if (this.active && revision === this.revision) this.fail(new RoomAudioError("signaling-unavailable", "Signaling stopped; restart audio"));
      });
    } catch (cause) {
      if (!this.active || revision !== this.revision) return;
      const error = cause instanceof RoomAudioError ? cause
        : new RoomAudioError("signaling-unavailable", "Could not verify the room session; restart audio");
      this.fail(error);
      throw error;
    }
  }

  /** Rebuilds audio connections while preserving the room session and microphone. */
  reconnect(): void {
    if (!this.active || !this.transport) return;
    this.clearPeers();
    this.setState("reconnecting");
    this.transport.abort();
  }

  /** Stops capture and peer playback immediately; membership remains until leave/expiry. */
  async stop(): Promise<void> {
    const connectionId = this.self?.connectionId;
    const wasActive = this.active;
    this.stopLocal();
    this.setState("closed");
    if (wasActive) {
      const response = await fetch(this.microphoneUrl(), {
        method: "PUT", headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mute" }),
        signal: AbortSignal.timeout(5_000), keepalive: true,
      });
      if (![200, 401, 404].includes(response.status)) await this.requireOk(response);
    }
    if (connectionId) {
      const response = await fetch(`${this.roomUrl}/audio/connections/${connectionId}`, {
        method: "DELETE", headers: this.headers(),
        signal: AbortSignal.timeout(5_000), keepalive: true,
      });
      if (![204, 401].includes(response.status)) await this.requireOk(response);
    }
  }

  /** Full room departure, using the original leave endpoint. */
  async leave(): Promise<void> {
    try { await this.stop(); } catch {
      this.options.onError?.(new RoomAudioError("signaling-unavailable", "Audio stopped locally; server disconnect could not be confirmed"));
    }
    const response = await fetch(this.sessionUrl(), {
      method: "DELETE", signal: AbortSignal.timeout(5_000),
    });
    if (response.status !== 404) await this.requireOk(response);
  }

  async resumePlayback(): Promise<void> {
    await Promise.all([...this.peers.values()].map((peer) => peer.play()));
  }

  getDiagnostics() {
    return {
      state: this.state,
      microphoneActive: this.stream?.getAudioTracks().some((t) => t.readyState === "live") ?? false,
      microphoneEnabled: this.stream?.getAudioTracks().some((t) => t.readyState === "live" && t.enabled) ?? false,
      peers: [...this.peers.entries()].map(([participantId, peer]) => ({
        participantId, connectionId: peer.options.remote.connectionId,
        state: peer.pc.connectionState,
        remoteTracks: (peer.audio.srcObject as MediaStream | null)?.getAudioTracks().length ?? 0,
        playbackActive: !!peer.audio.srcObject && !peer.audio.paused,
        playbackMuted: peer.audio.muted,
      })),
    };
  }

  async getPeerStats() {
    return Promise.all([...this.peers.entries()].map(async ([participantId, peer]) => {
      let bytesReceived = 0, bytesSent = 0, audioEnergy = 0;
      const stats = await peer.pc.getStats();
      stats.forEach((report) => {
        if (report.kind !== "audio") return;
        if (report.type === "inbound-rtp") {
          bytesReceived += report.bytesReceived ?? 0;
          audioEnergy += report.totalAudioEnergy ?? 0;
        }
        if (report.type === "outbound-rtp") bytesSent += report.bytesSent ?? 0;
      });
      return { participantId, bytesReceived, bytesSent, audioEnergy };
    }));
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.options.participantSessionId}` };
  }

  private sessionUrl(): string {
    return `${this.roomUrl}/participants/${encodeURIComponent(this.options.participantSessionId)}`;
  }

  private microphoneUrl(): string {
    // Returned only by an authenticated heartbeat, not supplied by another caller.
    return `${this.roomUrl}/participants/${encodeURIComponent(this.participantId ?? "")}/microphone`;
  }

  private participantId?: string;

  private async requireOk(response: Response): Promise<void> {
    if (response.ok) return;
    if ([401, 404].includes(response.status)) {
      throw new RoomAudioError("session-expired", "Room session ended or expired; join the room again");
    }
    throw new RoomAudioError("signaling-unavailable", `Room audio request failed (${response.status})`);
  }

  private async heartbeat(): Promise<void> {
    try {
      const response = await fetch(`${this.sessionUrl()}/heartbeat`, {
        method: "POST", signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(10_000)]),
      });
      await this.requireOk(response);
      const participant = await response.json() as { participantId: string };
      this.participantId = participant.participantId;
    } catch (error) {
      if (error instanceof RoomAudioError) throw error;
      throw new RoomAudioError("signaling-unavailable", "Room heartbeat could not reach the server");
    }
  }

  private async runSignaling(): Promise<void> {
    let failures = 0;
    const revision = this.revision;
    while (this.active && revision === this.revision) {
      const transport = new AbortController();
      this.transport = transport;
      const abort = () => transport.abort();
      this.lifetime.signal.addEventListener("abort", abort, { once: true });
      const startedAt = Date.now();
      this.setState(failures ? "reconnecting" : "connecting");
      try {
        const response = await fetch(`${this.roomUrl}/audio/events`, {
          headers: this.headers(), signal: transport.signal,
        });
        await this.requireOk(response);
        await readAudioEvents(response, (event) => {
          if (this.active && !transport.signal.aborted && revision === this.revision) this.receive(event);
        });
        if (this.active) throw new RoomAudioError("signaling-unavailable", "Signaling connection closed");
      } catch (cause) {
        if (!this.active || revision !== this.revision) return;
        if (cause instanceof RoomAudioError && cause.code === "session-expired") {
          this.fail(cause);
          return;
        }
        if (!transport.signal.aborted) {
          this.options.onError?.(new RoomAudioError("signaling-unavailable", "Signaling was interrupted; reconnecting"));
        }
      } finally {
        this.lifetime.signal.removeEventListener("abort", abort);
      }
      if (!this.active || revision !== this.revision) return;
      this.self = undefined;
      this.clearPeers();
      this.setState("reconnecting");
      failures = Date.now() - startedAt >= 30_000 ? 1 : failures + 1;
      if (failures > 5) {
        this.fail(new RoomAudioError("signaling-unavailable", "Audio could not reconnect after five attempts; call start to retry"));
        return;
      }
      await new Promise<void>((resolve) => {
        const signal = this.lifetime.signal;
        const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, Math.min(500 * 2 ** (failures - 1), 8_000));
        signal.addEventListener("abort", finish, { once: true });
        if (signal.aborted) finish();
      });
    }
  }

  private receive(event: AudioEvent): void {
    if (event.type === "audio.ready") {
      this.clearPeers();
      this.self = event.data.self;
      this.syncPeers(event.data.peers);
    } else if (event.type === "audio.peers") {
      this.syncPeers(event.data.peers);
    } else if (event.type === "audio.microphones") {
      for (const participant of event.data.participants) {
        if (participant.participantId === this.self?.participantId) {
          this.setMicrophoneEnabled(participant.micEnabled);
        } else {
          this.setPeerMicrophoneEnabled(participant.participantId, participant.micEnabled);
        }
      }
    } else if (event.type === "audio.signal") {
      const peer = this.peers.get(event.data.from.participantId);
      if (peer?.options.remote.connectionId === event.data.from.connectionId) peer.receive(event.data.description);
    } else if (event.type === "audio.ended") {
      if (event.data.reason === "replaced") {
        this.fail(new RoomAudioError("session-in-use", "This session's audio was opened elsewhere; use a separate room session for another device"));
      } else if (event.data.reason === "participant-left") {
        this.fail(new RoomAudioError("session-expired", "Room session ended or expired; join again"));
      } else {
        this.stopLocal();
        this.setState("closed");
      }
    }
  }

  private syncPeers(roster: AudioPeer[]): void {
    const self = this.self;
    const stream = this.stream;
    if (!self || !stream) return;
    for (const [id, peer] of this.peers) {
      if (!roster.some((p) => p.participantId === id && p.connectionId === peer.options.remote.connectionId)) {
        peer.close();
        this.peers.delete(id);
        this.options.onPeerState?.(id, "closed");
      }
    }
    for (const remote of roster) {
      if (remote.participantId === self.participantId || this.peers.has(remote.participantId)) continue;
      const peer = new AudioConnection({
        remote, stream,
        configuration: { iceServers: this.options.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }] },
        offerer: self.participantId < remote.participantId,
        send: async (description) => {
          if (!this.active || this.self !== self || peer.closed) return;
          const response = await fetch(`${this.roomUrl}/audio/signals`, {
            method: "POST",
            headers: { ...this.headers(), "Content-Type": "application/json" },
            signal: this.transport?.signal,
            body: JSON.stringify({
              sourceConnectionId: self.connectionId,
              targetParticipantId: remote.participantId,
              targetConnectionId: remote.connectionId, description,
            }),
          });
          await this.requireOk(response);
        },
        changed: () => {
          if (peer.closed || this.peers.get(remote.participantId) !== peer) return;
          this.options.onPeerState?.(remote.participantId, peer.pc.connectionState);
          this.updateState();
        },
        failed: (error) => {
          if (this.peers.get(remote.participantId) !== peer) return;
          this.options.onError?.(error);
          this.reconnect();
        },
        warning: (error) => this.options.onError?.(error),
      });
      peer.audio.muted = !this.allowedPeers.get(remote.participantId);
      this.peers.set(remote.participantId, peer);
    }
    this.updateState();
  }

  private updateState(): void {
    if (!this.active || !this.self) return;
    this.setState(this.peers.size === 0 ? "ready"
      : [...this.peers.values()].every((p) => p.pc.connectionState === "connected") ? "connected" : "connecting");
  }

  private clearPeers(): void {
    for (const [id, peer] of this.peers) {
      peer.close();
      this.options.onPeerState?.(id, "closed");
    }
    this.peers.clear();
  }

  private stopLocal(): void {
    this.active = false;
    ++this.revision;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    this.lifetime.abort();
    this.transport?.abort();
    this.clearPeers();
    for (const track of this.stream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    this.stream = undefined;
    this.self = undefined;
  }

  private fail(error: RoomAudioError): void {
    this.stopLocal();
    this.setState("error");
    this.options.onError?.(error);
  }

  private setState(state: AudioState): void {
    if (state === this.currentState) return;
    this.currentState = state;
    this.options.onState?.(state);
  }
}