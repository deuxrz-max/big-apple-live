import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GiftIcon } from '@/social/common';

export type BigTierGiftId = 'fireworks' | 'rose-shower' | 'whip';
export type RoomGiftId = 'heart' | 'spirit-pup' | 'moonfox' | 'cosmic-encore' | BigTierGiftId;
type AnimatedGiftId = 'spirit-pup' | 'moonfox';
const MEDIA: Record<Exclude<RoomGiftId, 'heart'>, string> = {
  'spirit-pup': `${import.meta.env.BASE_URL}api/gift-media/spirit-pup/v1/`,
  moonfox: `${import.meta.env.BASE_URL}api/gift-media/moonfox/v1/`,
  'cosmic-encore': `${import.meta.env.BASE_URL}api/gift-media/cosmic-encore/v2/`,
  fireworks: `${import.meta.env.BASE_URL}api/gift-media/fireworks/v3/`,
  'rose-shower': `${import.meta.env.BASE_URL}api/gift-media/rose-shower/v3/`,
  whip: `${import.meta.env.BASE_URL}api/gift-media/whip/v3/`,
};
const CATALOG_ICON: Record<RoomGiftId, string> = {
  heart: `${import.meta.env.BASE_URL}gift-icons/heart.svg`,
  'spirit-pup': `${MEDIA['spirit-pup']}icon-small.png`,
  moonfox: `${MEDIA.moonfox}icon-small.png`,
  'cosmic-encore': `${MEDIA['cosmic-encore']}icon-small.png`,
  fireworks: `${import.meta.env.BASE_URL}gift-icons/fireworks.png`,
  'rose-shower': `${import.meta.env.BASE_URL}gift-icons/rose-shower.png`,
  whip: `${import.meta.env.BASE_URL}gift-icons/whip.png`,
};
const DURATION: Record<AnimatedGiftId, number> = {
  'spirit-pup': 4000,
  moonfox: 4000,
};

export function RoomGiftIcon({ giftId, size = 64, className = 'spirit-gift-icon' }: {
  giftId: RoomGiftId;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return failed
    ? <span className={className} style={{ width: size, height: size, display: 'grid', placeItems: 'center' }}>
      <GiftIcon id={giftId} size={Math.round(size * 0.62)} />
    </span>
    : <img className={className} src={CATALOG_ICON[giftId]} width={size} height={size}
      style={{ width: size, height: size, objectFit: 'contain' }} alt="" aria-hidden="true" onError={() => setFailed(true)} />;
}

export function SpiritIcon() { return <RoomGiftIcon giftId="spirit-pup" />; }
export function MoonfoxIcon() { return <RoomGiftIcon giftId="moonfox" />; }
export const cosmicEncoreMedia = {
  animation: `${MEDIA['cosmic-encore']}animation.mp4`,
  fallback: `${MEDIA['cosmic-encore']}fallback.webp`,
};

export const roomGiftMiniMedia: Record<RoomGiftId, { video?: string; image?: string; still: string }> = {
  heart: { still: CATALOG_ICON.heart },
  'spirit-pup': { video: `${MEDIA['spirit-pup']}animation.webm`, image: `${MEDIA['spirit-pup']}animation.webp`, still: CATALOG_ICON['spirit-pup'] },
  moonfox: { video: `${MEDIA.moonfox}animation.webm`, image: `${MEDIA.moonfox}animation.webp`, still: CATALOG_ICON.moonfox },
  'cosmic-encore': { video: cosmicEncoreMedia.animation, image: cosmicEncoreMedia.fallback, still: CATALOG_ICON['cosmic-encore'] },
  fireworks: { video: `${MEDIA.fireworks}animation.webm`, image: `${MEDIA.fireworks}animation.webp`, still: CATALOG_ICON.fireworks },
  'rose-shower': { video: `${MEDIA['rose-shower']}animation.webm`, image: `${MEDIA['rose-shower']}animation.webp`, still: CATALOG_ICON['rose-shower'] },
  whip: { video: `${MEDIA.whip}animation.webm`, image: `${MEDIA.whip}animation.webp`, still: CATALOG_ICON.whip },
};

function preferImages() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
    || (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent));
}

/** Check decoded video alpha before showing it; fall back through transparent image formats. */
export function RoomGiftAnimation({ giftId, onFinish }: { giftId: AnimatedGiftId; onFinish: () => void }) {
  const duration = DURATION[giftId];
  const [mode, setMode] = useState<'checking' | 'video' | 'webp' | 'apng' | 'still'>(preferImages() ? 'webp' : 'checking');
  const [mediaError, setMediaError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const finished = useRef(false);
  const done = useRef(onFinish);
  done.current = onFinish;
  const finish = () => { if (!finished.current) { finished.current = true; done.current(); } };
  const start = () => {
    if (loadingTimer.current) clearTimeout(loadingTimer.current);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(finish, duration);
  };
  useEffect(() => {
    loadingTimer.current = setTimeout(finish, 10000);
    return () => { if (loadingTimer.current) clearTimeout(loadingTimer.current); if (timer.current) clearTimeout(timer.current); };
  }, []);
  return createPortal(<div className="spirit-overlay" aria-hidden={mediaError ? undefined : true} data-testid={`${giftId}-animation`}>
    {(mode === 'checking' || mode === 'video') ? (
      <video src={`${MEDIA[giftId]}animation.webm`} autoPlay muted playsInline preload="auto"
        aria-hidden="true"
        style={{ visibility: mode === 'video' ? 'visible' : 'hidden' }}
        onLoadedData={async e => {
          const video = e.currentTarget;
          try {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Alpha check unavailable');
            ctx.drawImage(video, 0, 0, 1, 1, 0, 0, 1, 1);
            if (ctx.getImageData(0, 0, 1, 1).data[3]! > 8) throw new Error('Opaque video');
            setMode('video'); await video.play(); start();
          } catch { setMode('webp'); }
        }} onEnded={finish} onError={() => setMode('webp')} />
    ) : <img src={`${MEDIA[giftId]}${mode === 'webp' ? 'animation.webp' : mode === 'apng' ? 'animation.png' : 'icon.png'}`}
      alt="" aria-hidden="true" onLoad={start} onError={() => {
        if (mode === 'webp') setMode('apng');
        else if (mode === 'apng') { setMode('still'); setMediaError(true); }
        else finish();
      }} />}
    {mediaError && <span className="gift-animation-error" role="status">{giftId === 'spirit-pup' ? 'Spirit Pup' : 'Moonfox'} animation could not load.</span>}
  </div>, document.body);
}

export function SpiritAnimation({ onFinish }: { onFinish: () => void }) {
  return <RoomGiftAnimation giftId="spirit-pup" onFinish={onFinish} />;
}

export function MoonfoxAnimation({ onFinish }: { onFinish: () => void }) {
  return <RoomGiftAnimation giftId="moonfox" onFinish={onFinish} />;
}

/** Full-scene premium gift: keep its supplied background and show the still if video playback fails. */
export function CosmicEncoreAnimation({ onFinish }: { onFinish: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const done = useRef(onFinish);
  done.current = onFinish;
  const fallbackShown = useRef(false);
  const completed = useRef(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [fallback, setFallback] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const finish = () => {
    if (completed.current) return;
    completed.current = true;
    done.current();
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const clearTimers = () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      if (finishTimer.current) clearTimeout(finishTimer.current);
      if (loadTimer.current) clearTimeout(loadTimer.current);
    };
    const scheduleEnd = (durationMs: number) => {
      clearTimers();
      fadeTimer.current = setTimeout(() => setFadingOut(true), Math.max(0, durationMs - 1000));
      finishTimer.current = setTimeout(finish, durationMs + 1100);
    };
    const showStill = () => {
      if (fallbackShown.current) return;
      fallbackShown.current = true;
      setFallback(true);
      scheduleEnd(6042);
    };
    const loaded = () => {
      const durationMs = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : 6042;
      scheduleEnd(durationMs);
      if (loadTimer.current) clearTimeout(loadTimer.current);
    };
    const playable = () => {
      void video.play().catch(showStill);
    };
    video.addEventListener('loadedmetadata', loaded);
    video.addEventListener('canplay', playable);
    video.addEventListener('error', showStill);
    loadTimer.current = setTimeout(showStill, 3500);
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) loaded();
    if (video.error) showStill();
    return () => {
      video.removeEventListener('loadedmetadata', loaded);
      video.removeEventListener('canplay', playable);
      video.removeEventListener('error', showStill);
      video.pause();
      clearTimers();
    };
  }, []);

  return createPortal(<div className="cosmic-encore-overlay" aria-hidden="true" data-testid="cosmic-encore-animation">
    {fallback ? (
      <img className={`cosmic-encore-media${fadingOut ? ' is-fading-out' : ''}`} src={cosmicEncoreMedia.fallback} alt=""
        onAnimationEnd={event => { if (event.animationName === 'cosmic-encore-fade-out') finish(); }} />
    ) : (
      <video ref={videoRef} className={`cosmic-encore-media${fadingOut ? ' is-fading-out' : ''}`}
        src={cosmicEncoreMedia.animation} poster={cosmicEncoreMedia.fallback}
        autoPlay muted playsInline preload="auto" onEnded={() => setFadingOut(true)}
        onAnimationEnd={event => { if (event.animationName === 'cosmic-encore-fade-out') finish(); }} />
    )}
    {fallback && <span className="cosmic-encore-fallback-note" role="status">Cosmic Encore video could not play; showing its artwork.</span>}
  </div>, document.body);
}
