import type { AudioSignalInput, UniversityAudioState } from "@workspace/api-zod";
import { readAudioEvents } from "./events";
import { AudioConnection } from "./peer";
import { RoomAudioError, type AudioPeer, type AudioState, type AudioEvent } from "./protocol";

export type UniversityAudioPeerStats = {
  participantId: string;
  state: RTCPeerConnectionState;
  signalingState: RTCSignalingState;
  iceGatheringState: RTCIceGatheringState;
  iceConnectionState: RTCIceConnectionState;
  bytesSent: number;
  bytesReceived: number;
  audioLevel: number;
};

export interface UniversityAudioClientOptions {
  roomId: string;
  roomSessionId: string;
  /** Same-origin API prefix; no provider or media-server URL is used. */
  baseUrl?: string;
  role: "listener" | "speaker";
  microphoneStream?: MediaStream;
  iceServers?: RTCIceServer[];
  onState?(state: AudioState): void;
  onBeam?(state: UniversityAudioState): void;
  onPeerState?(participantId: string, state: RTCPeerConnectionState): void;
  onSpeaking?(participantIds: string[]): void;
  onError?(error: RoomAudioError): void;
}

/** University-only P2P audio client. Listeners never acquire a microphone. */
export class UniversityAudioClient {
  private active = false;
  private revision = 0;
  private lifetime = new AbortController();
  private transport?: AbortController;
  private self?: AudioPeer;
  private currentRole: "listener" | "speaker";
  private readonly peers = new Map<string, AudioConnection>();
  private readonly allowedPeers = new Map<string, boolean>();
  private currentState: AudioState = "idle";
  private readonly audioUrl: string;
  private speakingInterval?: ReturnType<typeof setInterval>;

  constructor(private readonly options: UniversityAudioClientOptions) {
    this.currentRole = options.role;
    this.audioUrl = `${(options.baseUrl ?? "/api").replace(/\/$/, "")}/account/rooms/${encodeURIComponent(options.roomId)}/audio`;
  }

  get state(): AudioState { return this.currentState; }

  setMicrophoneEnabled(enabled: boolean): void {
    for (const track of this.options.microphoneStream?.getAudioTracks() ?? []) track.enabled = enabled;
  }

  async start(): Promise<void> {
    if (this.active) return;
    if (typeof RTCPeerConnection === "undefined") {
      throw new RoomAudioError("unsupported", "This browser does not support peer audio.");
    }
    if (this.options.role === "speaker" && !this.options.microphoneStream?.getAudioTracks().length) {
      throw new RoomAudioError("microphone-unavailable", "Join a speaker spot using an available microphone.");
    }
    this.active = true;
    const revision = ++this.revision;
    this.lifetime = new AbortController();
    this.setMicrophoneEnabled(false);
    this.setState("connecting");
    this.speakingInterval = setInterval(() => { void this.pollSpeaking(); }, 400);
    void this.runSignaling(revision);
  }

  async resumePlayback(): Promise<void> {
    await Promise.all([...this.peers.values()].map(peer => peer.play()));
  }

  getDiagnostics() {
    return [...this.peers].map(([participantId, peer]) => ({
      participantId,
      state: peer.pc.connectionState,
      remoteAudioTracks: (peer.audio.srcObject as MediaStream | null)?.getAudioTracks().length ?? 0,
      playbackActive: !!peer.audio.srcObject && !peer.audio.paused,
      playbackMuted: peer.audio.muted,
    }));
  }

  async getPeerStats(): Promise<UniversityAudioPeerStats[]> {
    return Promise.all([...this.peers].map(async ([participantId, peer]) => {
      const reports = await peer.pc.getStats();
      let bytesSent = 0;
      let bytesReceived = 0;
      let audioLevel = 0;
      for (const report of reports.values()) {
        if (report.type === "outbound-rtp") {
          const audio = report as RTCOutboundRtpStreamStats;
          if (audio.kind === "audio") bytesSent += audio.bytesSent ?? 0;
        } else if (report.type === "inbound-rtp") {
          const audio = report as RTCInboundRtpStreamStats;
          if (audio.kind === "audio") {
            bytesReceived += audio.bytesReceived ?? 0;
            audioLevel = Math.max(audioLevel, audio.audioLevel ?? 0);
          }
        }
      }
      return {
        participantId,
        state: peer.pc.connectionState,
        signalingState: peer.pc.signalingState,
        iceGatheringState: peer.pc.iceGatheringState,
        iceConnectionState: peer.pc.iceConnectionState,
        bytesSent,
        bytesReceived,
        audioLevel,
      };
    }));
  }

  async stop(): Promise<void> {
    const connectionId = this.self?.connectionId;
    const wasActive = this.active;
    this.stopLocal();
    this.setState("closed");
    if (!wasActive || !connectionId) return;
    try {
      await fetch(`${this.audioUrl}/connections/${encodeURIComponent(connectionId)}`, {
        method: "DELETE", headers: this.headers(), credentials: "include",
        signal: AbortSignal.timeout(5_000), keepalive: true,
      });
    } catch {
      // Closing SSE also removes the server-side connection and frees its slot.
    }
  }

  private headers(): Record<string, string> {
    return { "X-Room-Session": this.options.roomSessionId };
  }

  private async runSignaling(revision: number): Promise<void> {
    let failures = 0;
    while (this.active && revision === this.revision) {
      const transport = new AbortController();
      this.transport = transport;
      const abort = () => transport.abort();
      this.lifetime.signal.addEventListener("abort", abort, { once: true });
      const startedAt = Date.now();
      try {
        const response = await fetch(`${this.audioUrl}/events`, {
          headers: this.headers(),
          credentials: "include",
          signal: transport.signal,
        });
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) {
            throw new RoomAudioError("session-expired", "The room session ended; re-enter the university.");
          }
          throw new RoomAudioError("signaling-unavailable", `Peer audio connection failed (${response.status}).`);
        }
        this.setState("connecting");
        await readAudioEvents(response, event => {
          if (this.active && !transport.signal.aborted && revision === this.revision) this.receive(event);
        });
        if (this.active) throw new RoomAudioError("signaling-unavailable", "Peer audio signaling disconnected.");
      } catch (cause) {
        if (!this.active || revision !== this.revision) return;
        if (cause instanceof RoomAudioError && cause.code === "session-expired") {
          this.fail(cause);
          return;
        }
        if (!transport.signal.aborted) {
          this.options.onError?.(cause instanceof RoomAudioError ? cause
            : new RoomAudioError("signaling-unavailable", "Peer audio signaling was interrupted; reconnecting."));
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
        this.fail(new RoomAudioError("signaling-unavailable", "Peer audio could not reconnect after several attempts."));
        return;
      }
      await new Promise<void>(resolve => {
        const signal = this.lifetime.signal;
        const timer = setTimeout(done, Math.min(500 * 2 ** (failures - 1), 8_000));
        function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
        signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      });
    }
  }

  private receive(event: AudioEvent): void {
    if (event.type === "audio.ready") {
      this.clearPeers();
      this.self = event.data.self;
      this.currentRole = event.data.self.role ?? "listener";
      if (this.currentRole !== "speaker") this.setMicrophoneEnabled(false);
      this.syncPeers(event.data.peers);
    } else if (event.type === "audio.peers") {
      this.syncPeers(event.data.peers);
    } else if (event.type === "audio.microphones") {
      for (const participant of event.data.participants) {
        if (participant.participantId === this.self?.participantId) this.setMicrophoneEnabled(participant.micEnabled);
        else this.setPeerMicrophoneEnabled(participant.participantId, participant.micEnabled);
      }
    } else if (event.type === "audio.beam") {
      this.options.onBeam?.(event.data);
      const ownSlot = event.data.slots.find(slot => slot.participantId === this.self?.participantId);
      if (!ownSlot) {
        this.setMicrophoneEnabled(false);
        if (this.currentRole === "speaker") {
          this.currentRole = "listener";
          this.clearPeers();
          this.self = this.self ? { ...this.self, role: "listener" } : undefined;
          this.setState("closed");
          this.stopLocal();
        }
      } else {
        this.setMicrophoneEnabled(ownSlot.micEnabled && !ownSlot.mutedByHost);
      }
    } else if (event.type === "audio.signal") {
      const peer = this.peers.get(event.data.from.participantId);
      if (peer?.options.remote.connectionId === event.data.from.connectionId) peer.receive(event.data.description);
    } else if (event.type === "audio.ended") {
      if (event.data.reason === "replaced") {
        this.fail(new RoomAudioError("session-in-use", "Audio was connected from another tab or device."));
      } else if (event.data.reason === "participant-left") {
        this.fail(new RoomAudioError("session-expired", "You were removed from the university."));
      } else {
        this.setMicrophoneEnabled(false);
        this.stopLocal();
        this.setState("closed");
      }
    }
  }

  private setPeerMicrophoneEnabled(participantId: string, enabled: boolean): void {
    this.allowedPeers.set(participantId, enabled);
    const peer = this.peers.get(participantId);
    if (peer) peer.audio.muted = !enabled;
  }

  private syncPeers(roster: AudioPeer[]): void {
    const self = this.self;
    if (!self) return;
    for (const [participantId, peer] of this.peers) {
      if (!roster.some(p => p.participantId === participantId && p.connectionId === peer.options.remote.connectionId)) {
        peer.close();
        this.peers.delete(participantId);
        this.options.onPeerState?.(participantId, "closed");
      }
    }
    for (const remote of roster) {
      if (remote.participantId === self.participantId || this.peers.has(remote.participantId)) continue;
      let peer!: AudioConnection;
      peer = new AudioConnection({
        remote,
        stream: this.currentRole === "speaker" ? this.options.microphoneStream : undefined,
        configuration: { iceServers: this.options.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }] },
        offerer: self.participantId < remote.participantId,
        send: async description => {
          if (!this.active || this.self !== self || peer.closed) return;
          const payload: AudioSignalInput = {
            sourceConnectionId: self.connectionId,
            targetParticipantId: remote.participantId,
            targetConnectionId: remote.connectionId,
            description,
          };
          const response = await fetch(`${this.audioUrl}/signals`, {
            method: "POST",
            headers: { ...this.headers(), "Content-Type": "application/json" },
            credentials: "include",
            signal: this.transport?.signal,
            body: JSON.stringify(payload),
          });
          if (!response.ok) throw new RoomAudioError("signaling-unavailable", `Peer audio signal failed (${response.status}).`);
        },
        changed: () => {
          if (peer.closed || this.peers.get(remote.participantId) !== peer) return;
          this.options.onPeerState?.(remote.participantId, peer.pc.connectionState);
          this.updateState();
        },
        failed: error => {
          if (this.peers.get(remote.participantId) !== peer) return;
          this.options.onError?.(error);
        },
        warning: error => this.options.onError?.(error),
      });
      peer.audio.muted = !this.allowedPeers.get(remote.participantId);
      this.peers.set(remote.participantId, peer);
    }
    this.updateState();
  }

  private updateState(): void {
    if (!this.active || !this.self) return;
    const connections = [...this.peers.values()];
    this.setState(connections.length === 0 ? "ready"
      : connections.every(peer => peer.pc.connectionState === "connected") ? "connected" : "connecting");
  }

  private async pollSpeaking(): Promise<void> {
    if (!this.active) return;
    const active = new Set<string>();
    let selfIsSpeaking = false;
    await Promise.all([...this.peers].map(async ([participantId, peer]) => {
      try {
        const stats = await peer.pc.getStats();
        for (const report of stats.values()) {
          if (report.type !== "inbound-rtp" && report.type !== "outbound-rtp") continue;
          if (report.kind !== "audio" && report.mediaType !== "audio") continue;
          if (typeof report.audioLevel !== "number" || report.audioLevel < 0.045) continue;
          if (report.type === "outbound-rtp") selfIsSpeaking = true;
          if (report.type === "inbound-rtp") active.add(participantId);
        }
      } catch { /* a peer may close while statistics are being read */ }
    }));
    if (selfIsSpeaking && this.currentRole === "speaker" && this.self) active.add(this.self.participantId);
    this.options.onSpeaking?.([...active]);
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
    if (this.speakingInterval) clearInterval(this.speakingInterval);
    this.speakingInterval = undefined;
    this.lifetime.abort();
    this.transport?.abort();
    this.clearPeers();
    this.options.onSpeaking?.([]);
    for (const track of this.options.microphoneStream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
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
