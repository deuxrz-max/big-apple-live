import { useEffect, useRef, useState } from "react";
import type { RoomEntranceEffectEvent } from "./useTextRoom";

const media = `${import.meta.env.BASE_URL}api/room-entry-effects/lion`;
const mediaUrl = (filename: string) => `${media}/${filename}?v=2`;

export function RoomEntranceEffectOverlay({
  event,
  onFinish,
}: {
  event: RoomEntranceEffectEvent | null;
  onFinish: (eventId: string) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [posterFallback, setPosterFallback] = useState(false);

  useEffect(() => {
    setPosterFallback(false);
    if (!event) return;
    const elapsed = Math.max(0, Date.now() - event.startedAt);
    const remaining = Math.max(0, event.durationMs - elapsed);
    if (!remaining) {
      onFinish(event.eventId);
      return;
    }
    const audio = new Audio(mediaUrl("audio.m4a"));
    audioRef.current = audio;
    audio.preload = "auto";
    try { audio.currentTime = elapsed / 1000; } catch { /* Media may not have metadata yet. */ }
    const finishTimer = window.setTimeout(() => onFinish(event.eventId), remaining);
    return () => {
      window.clearTimeout(finishTimer);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [event?.eventId, event?.startedAt, event?.durationMs, onFinish]);

  if (!event) return null;

  const startSound = () => {
    const audio = audioRef.current;
    if (!audio || !audio.paused) return;
    void audio.play().catch(() => {
      // Browsers may block entrance audio without a user gesture. The transparent
      // animation still plays; retry muted so playback is never held back.
      audio.muted = true;
      void audio.play().catch(() => {});
    });
  };

  return (
    <div className="ur-room-entry-effect" aria-hidden="true" data-testid="room-entrance-effect">
      <img
        src={mediaUrl(posterFallback ? "poster.png" : "animation.webp")}
        alt=""
        draggable={false}
        onLoad={startSound}
        onError={() => { if (!posterFallback) setPosterFallback(true); }}
      />
    </div>
  );
}
