import {
  RoomAudioError,
  type AudioPeer,
  type AudioDescription,
  type UniversityIceCandidate,
} from "./protocol";

type PeerOptions = {
  remote: AudioPeer;
  stream?: MediaStream;
  configuration: RTCConfiguration;
  offerer: boolean;
  send(description: AudioDescription): Promise<void>;
  trickleIce?: boolean;
  sendCandidate?(candidate: UniversityIceCandidate | null): Promise<void>;
  changed(): void;
  failed(error: RoomAudioError): void;
  warning(error: RoomAudioError): void;
};

export class AudioConnection {
  readonly pc: RTCPeerConnection;
  readonly audio = new Audio();
  private readonly abort = new AbortController();
  private queue = Promise.resolve();
  private pendingCandidates: (UniversityIceCandidate | null)[] = [];
  private negotiationTimer: ReturnType<typeof setTimeout>;
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  closed = false;

  constructor(readonly options: PeerOptions) {
    this.pc = new RTCPeerConnection(options.configuration);
    this.audio.autoplay = true;
    this.pc.onicecandidate = (event) => {
      if (!options.trickleIce || !options.sendCandidate || this.closed) return;
      const candidate: UniversityIceCandidate | null = event.candidate
        ? {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            usernameFragment: event.candidate.usernameFragment,
          }
        : null;
      void options.sendCandidate(candidate).catch(() => {
        if (!this.closed) {
          options.failed(new RoomAudioError("signaling-unavailable", "Could not send an ICE candidate; reconnecting"));
        }
      });
    };
    this.pc.ontrack = (event) => {
      if (event.track.kind !== "audio" || this.closed) return;
      this.audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void this.play().catch((error: RoomAudioError) => options.warning(error));
      options.changed();
    };
    this.pc.onconnectionstatechange = () => {
      if (this.closed) return;
      if (this.pc.connectionState === "connected") {
        clearTimeout(this.negotiationTimer);
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = undefined;
      } else if (this.pc.connectionState === "failed") {
        options.failed(new RoomAudioError("peer-connection-failed", "Audio connection failed; reconnecting"));
      } else if (this.pc.connectionState === "disconnected" && !this.disconnectTimer) {
        this.disconnectTimer = setTimeout(() => {
          if (!this.closed && this.pc.connectionState === "disconnected") {
            options.failed(new RoomAudioError("peer-connection-failed", "Audio connection was interrupted; reconnecting"));
          }
        }, 10_000);
      }
      options.changed();
    };
    if (options.stream) {
      for (const track of options.stream.getAudioTracks()) {
        const sender = this.pc.addTrack(track, options.stream);
        try {
          const parameters = sender.getParameters();
          if (!parameters.encodings.length) parameters.encodings = [{}];
          parameters.encodings[0]!.maxBitrate = 32_000;
          void sender.setParameters(parameters).catch(() => {});
        } catch { /* some browsers do not expose sender encoding controls */ }
      }
    } else {
      this.pc.addTransceiver("audio", { direction: "recvonly" });
    }
    this.negotiationTimer = setTimeout(() => {
      if (!this.closed && this.pc.connectionState !== "connected") {
        options.failed(new RoomAudioError("peer-connection-failed", "Audio negotiation timed out; reconnecting"));
      }
    }, 30_000);
    if (options.offerer) {
      this.enqueue(async () => {
        await this.pc.setLocalDescription(await this.pc.createOffer());
        await this.sendDescription("offer");
      });
    }
  }

  receive(description: AudioDescription): void {
    this.enqueue(async () => {
      await this.pc.setRemoteDescription(description);
      await this.flushPendingCandidates();
      if (description.type === "offer") {
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        await this.sendDescription("answer");
      }
    });
  }

  receiveCandidate(candidate: UniversityIceCandidate | null): void {
    this.enqueue(async () => {
      if (!this.pc.remoteDescription) {
        this.pendingCandidates.push(candidate);
        return;
      }
      await this.pc.addIceCandidate(candidate);
    });
  }

  async play(): Promise<void> {
    if (!this.audio.srcObject || this.closed) return;
    try {
      await this.audio.play();
    } catch {
      throw new RoomAudioError("playback-blocked", "Browser blocked playback; call resumePlayback from a user action");
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    clearTimeout(this.negotiationTimer);
    clearTimeout(this.disconnectTimer);
    this.pendingCandidates = [];
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.close();
    this.audio.pause();
    this.audio.srcObject = null;
  }

  private enqueue(operation: () => Promise<void>): void {
    this.queue = this.queue.then(async () => {
      if (!this.closed) await operation();
    }).catch(() => {
      if (!this.closed) {
        this.options.failed(new RoomAudioError("peer-connection-failed", "Could not negotiate peer audio; reconnecting"));
      }
    });
  }

  private async sendDescription(type: "offer" | "answer"): Promise<void> {
    // The university beam trickles candidates separately; legacy audio peers
    // retain the original complete-SDP signaling behavior.
    if (!this.options.trickleIce) await this.gatherIce();
    if (!this.closed && this.pc.localDescription) {
      await this.options.send({ type, sdp: this.pc.localDescription.sdp });
    }
  }

  private async flushPendingCandidates(): Promise<void> {
    const candidates = this.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      if (this.closed) return;
      await this.pc.addIceCandidate(candidate);
    }
  }

  private async gatherIce(): Promise<void> {
    if (this.pc.iceGatheringState === "complete") return;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.pc.removeEventListener("icegatheringstatechange", changed);
        this.abort.signal.removeEventListener("abort", aborted);
        if (error) reject(error); else resolve();
      };
      const changed = () => {
        if (this.pc.iceGatheringState === "complete") finish();
      };
      const aborted = () => finish(new Error("Peer closed"));
      const timer = setTimeout(() => finish(new Error("ICE gathering timed out")), 15_000);
      this.pc.addEventListener("icegatheringstatechange", changed);
      this.abort.signal.addEventListener("abort", aborted, { once: true });
      if (this.abort.signal.aborted) aborted(); else changed();
    });
  }
}