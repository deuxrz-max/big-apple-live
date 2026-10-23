import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { connectChessAudio } from "@workspace/api-client-react";

export type ChessAudioState = "off" | "connecting" | "on" | "error";

/** Mic-only voice for a chess room. Connects only on explicit tap; microphone only. */
export function useChessAudio(roomId: string, accountKey: string) {
  const [state, setState] = useState<ChessAudioState>("off");
  const [error, setError] = useState("");
  const roomRef = useRef<Room | null>(null);
  const sinkRef = useRef<HTMLDivElement | null>(null);

  const stop = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      room.localParticipant.audioTrackPublications.forEach(pub => pub.track?.stop());
      void room.disconnect(true);
    }
    sinkRef.current?.replaceChildren();
    setState("off");
  }, []);

  const start = useCallback(async () => {
    if (roomRef.current) return;
    setError(""); setState("connecting");
    const room = new Room({ adaptiveStream: false, dynacast: false });
    roomRef.current = room;
    const attach = (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach();
      el.autoplay = true;
      sinkRef.current?.appendChild(el);
    };
    room.on(RoomEvent.TrackSubscribed, attach);
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => { track.detach().forEach(el => el.remove()); });
    room.on(RoomEvent.Disconnected, () => { if (roomRef.current === room) { roomRef.current = null; setState("off"); } });
    try {
      const { url, token } = await connectChessAudio(roomId);
      if (roomRef.current !== room) return;
      await room.connect(url, token, { autoSubscribe: true });
      if (roomRef.current !== room) { void room.disconnect(true); return; }
      await room.localParticipant.setMicrophoneEnabled(true);
      room.remoteParticipants.forEach(p => p.audioTrackPublications.forEach(pub => { if (pub.track) attach(pub.track); }));
      setState("on");
    } catch {
      if (roomRef.current === room) { roomRef.current = null; void room.disconnect(true); }
      setError("Microphone could not start. Check permission and try again.");
      setState("error");
    }
  }, [roomId]);

  const toggle = useCallback(() => { if (roomRef.current) stop(); else void start(); }, [start, stop]);

  useEffect(() => () => stop(), [roomId, accountKey, stop]);

  return { state, error, toggle, stop, sinkRef };
}
