import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BigTierGiftId } from './SpiritPup';
import { RoseShowerEffect } from './RoseShowerEffect';
import './gifts.css';

export const bigTierGiftMedia: Record<BigTierGiftId, string> = {
  fireworks: `${import.meta.env.BASE_URL}api/gift-media/fireworks/v3/animation.webm`,
  'rose-shower': `${import.meta.env.BASE_URL}api/gift-media/rose-shower/v3/animation.webm`,
  whip: `${import.meta.env.BASE_URL}api/gift-media/whip/v3/animation.webm`,
};
const bigTierGiftFallback: Partial<Record<BigTierGiftId, string>> = {
  fireworks: `${import.meta.env.BASE_URL}api/gift-media/fireworks/v3/animation.webp`,
  'rose-shower': `${import.meta.env.BASE_URL}api/gift-media/rose-shower/v3/animation.webp`,
  whip: `${import.meta.env.BASE_URL}api/gift-media/whip/v3/animation.webp`,
};
const prefersAnimatedImage = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
  || (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent));

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
  if (giftId === 'rose-shower') {
    return <RoseShowerEffect senderName={senderName} onFinish={onFinish} />;
  }
  return <BigTierGiftVideoAnimation giftId={giftId} senderName={senderName} onFinish={onFinish} />;
}

function BigTierGiftVideoAnimation({ giftId, senderName, onFinish }: {
  giftId: Exclude<BigTierGiftId, 'rose-shower'>;
  senderName: string;
  onFinish: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const alreadyFinished = useRef(false);
  const fadeStarted = useRef(false);
  const [fadingOut, setFadingOut] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [useImageFallback, setUseImageFallback] = useState(
    () => Boolean(bigTierGiftFallback[giftId]) && prefersAnimatedImage(),
  );
  const gift = PRESENTATION[giftId];

  useEffect(() => {
    if (useImageFallback) {
      const fadeTimer = window.setTimeout(() => setFadingOut(true), 6200);
      const finishTimer = window.setTimeout(() => {
        if (alreadyFinished.current) return;
        alreadyFinished.current = true;
        finishRef.current();
      }, 6700);
      return () => {
        window.clearTimeout(fadeTimer);
        window.clearTimeout(finishTimer);
      };
    }
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
    const fail = () => {
      if (fadeStarted.current) return;
      if (bigTierGiftFallback[giftId]) {
        setUseImageFallback(true);
        return;
      }
      setMediaError(true);
      fadeTimer = window.setTimeout(fade, 1800);
    };
    const setPlaybackSafetyTimer = () => {
      if (safetyTimer !== undefined) window.clearTimeout(safetyTimer);
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : 6042;
      safetyTimer = window.setTimeout(fade, Math.max(4000, duration + 1400));
    };
    const playWhenReady = () => {
      void video.play().catch(fail);
    };

    video.addEventListener('loadedmetadata', setPlaybackSafetyTimer);
    video.addEventListener('canplay', playWhenReady);
    video.addEventListener('ended', fade);
    video.addEventListener('error', fail);
    safetyTimer = window.setTimeout(fade, 12000);
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) setPlaybackSafetyTimer();

    return () => {
      if (fadeTimer !== undefined) window.clearTimeout(fadeTimer);
      if (safetyTimer !== undefined) window.clearTimeout(safetyTimer);
      video.pause();
      video.removeEventListener('loadedmetadata', setPlaybackSafetyTimer);
      video.removeEventListener('canplay', playWhenReady);
      video.removeEventListener('ended', fade);
      video.removeEventListener('error', fail);
    };
  }, [giftId, useImageFallback]);

  return createPortal(<div
    className={`big-tier-gift-overlay big-tier-gift-overlay--${gift.position}${fadingOut ? ' is-fading-out' : ''}`}
    role="status"
    aria-live="polite"
    data-testid={`big-tier-${giftId}-animation`}
  >
    {useImageFallback ? (
      <img
        className="big-tier-gift-video big-tier-gift-video--alpha"
        src={bigTierGiftFallback[giftId]}
        alt=""
        aria-hidden="true"
        onError={() => setMediaError(true)}
      />
    ) : (
      <video
        ref={videoRef}
        className={`big-tier-gift-video${bigTierGiftFallback[giftId] ? ' big-tier-gift-video--alpha' : ''}`}
        src={bigTierGiftMedia[giftId]}
        autoPlay
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
      />
    )}
    <span className="big-tier-gift-banner">{senderName} sent {gift.name} {gift.emoji}</span>
    {mediaError && <span className="big-tier-gift-error" role="status">{gift.name} animation could not load.</span>}
  </div>, document.body);
}
