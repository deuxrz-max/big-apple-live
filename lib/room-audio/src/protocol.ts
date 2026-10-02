export type { AudioSignalInput, AudioDescription } from "@workspace/api-zod";

export interface AudioPeer {
  participantId: string;
  connectionId: string;
}

export type AudioEvent =
  | { type: "audio.ready"; data: { self: AudioPeer; peers: AudioPeer[] } }
  | { type: "audio.peers"; data: { peers: AudioPeer[] } }
  | {
      type: "audio.signal";
      data: {
        from: AudioPeer;
        description: { type: "offer" | "answer"; sdp: string };
      };
    }
  | {
      type: "audio.ended";
      data: { reason: "replaced" | "participant-left" | "disconnected" };
    };

export type AudioState =
  | "idle" | "requesting-microphone" | "ready" | "connecting"
  | "connected" | "reconnecting" | "error" | "closed";

export class RoomAudioError extends Error {
  constructor(
    public readonly code:
      | "microphone-denied" | "microphone-unavailable" | "unsupported"
      | "session-expired" | "session-in-use" | "signaling-unavailable"
      | "peer-connection-failed" | "playback-blocked",
    message: string,
  ) {
    super(message);
    this.name = "RoomAudioError";
  }
}