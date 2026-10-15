import { useEffect, useRef, useState } from 'react';
import type { BigTierGiftId } from './SpiritPup';
import './gifts.css';

export const bigTierGiftMedia: Record<BigTierGiftId, string> = {
  fireworks: `${import.meta.env.BASE_URL}api/gift-media/fireworks/v1/animation.mp4`,
  'rose-shower': `${import.meta.env.BASE_URL}api/gift-media/rose-shower/v1/animation.mp4`,
  whip: `${import.meta.env.BASE_URL}api/gift-media/whip/v1/animation.mp4`,
};

export const isBigTierGiftId = (id: string): id is BigTierGiftId =>
  id === 'fireworks' || id === 'rose-shower' || id === 'whip';

const PRESENTATION: Record<BigTierGiftId, { name: string; emoji: string; position: 'top' | 'full' | 'bottom' }> = {
  fireworks: { name: 'Fireworks', emoji: '🎆', position: 'top' },
  'rose-shower': { name: 'Rose Shower', emoji: '🌹', position: 'full' },
  whip: { name: 'Whip', emoji: '🏎️', position: 'bottom' },
};

export function BigTierGiftAnimation({ giftId, senderName, onFinish }: {
  giftId: BigTierGiftId;
  senderName: string;
  onFinish: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const alreadyFinished = useRef(false);
  const fadeStarted = useRef(false);
  const [fadingOut, setFadingOut] = useState(false);
  const gift = PRESENTATION[giftId];

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let fadeTimer: number | undefined;
    let safetyTimer: number | undefined;

    const complete = () => {
      if (alreadyFinished.current) return;
      alreadyFinished.current = true;
      finishRef.current();
    };
    const fade = () => {
      if (fadeStarted.current) return;
      fadeStarted.current = true;
      setFadingOut(true);
      fadeTimer = window.setTimeout(complete, 500);
    };
    const setPlaybackSafetyTimer = () => {
      if (safetyTimer !== undefined) window.clearTimeout(safetyTimer);
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : 6042;
      safetyTimer = window.setTimeout(fade, Math.max(4000, duration + 1400));
    };
    const playWhenReady = () => {
      void video.play().catch(fade);
    };

    video.addEventListener('loadedmetadata', setPlaybackSafetyTimer);
    video.addEventListener('canplay', playWhenReady);
    video.addEventListener('ended', fade);
    video.addEventListener('error', fade);
    safetyTimer = window.setTimeout(fade, 12000);
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) setPlaybackSafetyTimer();

    return () => {
      if (fadeTimer !== undefined) window.clearTimeout(fadeTimer);
      if (safetyTimer !== undefined) window.clearTimeout(safetyTimer);
      video.pause();
      video.removeEventListener('loadedmetadata', setPlaybackSafetyTimer);
      video.removeEventListener('canplay', playWhenReady);
      video.removeEventListener('ended', fade);
      video.removeEventListener('error', fade);
    };
  }, [giftId]);

  return <div
    className={`big-tier-gift-overlay big-tier-gift-overlay--${gift.position}${fadingOut ? ' is-fading-out' : ''}`}
    role="status"
    aria-live="polite"
    data-testid={`big-tier-${giftId}-animation`}
  >
    <video
      ref={videoRef}
      className="big-tier-gift-video"
      src={bigTierGiftMedia[giftId]}
      autoPlay
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
    />
    <span className="big-tier-gift-banner">{senderName} sent {gift.name} {gift.emoji}</span>
  </div>;
}
