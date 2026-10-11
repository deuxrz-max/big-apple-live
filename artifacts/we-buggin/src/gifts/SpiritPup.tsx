import { useEffect, useRef, useState } from 'react';
import { GiftIcon } from '@/social/common';

export type RoomGiftId = 'heart' | 'spirit-pup' | 'moonfox' | 'cosmic-encore';
type AnimatedGiftId = Exclude<RoomGiftId, 'heart' | 'cosmic-encore'>;
const MEDIA: Record<Exclude<RoomGiftId, 'heart'>, string> = {
  'spirit-pup': `${import.meta.env.BASE_URL}api/gift-media/spirit-pup/v1/`,
  moonfox: `${import.meta.env.BASE_URL}api/gift-media/moonfox/v1/`,
  'cosmic-encore': `${import.meta.env.BASE_URL}api/gift-media/cosmic-encore/v1/`,
};
const DURATION: Record<AnimatedGiftId, number> = {
  'spirit-pup': 4000,
  moonfox: 4000,
};

export function RoomGiftIcon({ giftId }: { giftId: RoomGiftId }) {
  const [failed, setFailed] = useState(false);
  if (giftId === 'heart') return <span className="heart-gift-catalog-icon" aria-hidden="true">❤️</span>;
  return failed
    ? <GiftIcon id={giftId} />
    : <img className="spirit-gift-icon" src={`${MEDIA[giftId]}icon-small.png`} width={64} height={64} alt="" aria-hidden="true" onError={() => setFailed(true)} />;
}

export function SpiritIcon() { return <RoomGiftIcon giftId="spirit-pup" />; }
export function MoonfoxIcon() { return <RoomGiftIcon giftId="moonfox" />; }
export const cosmicEncoreMedia = {
  animation: `${MEDIA['cosmic-encore']}animation.mp4`,
  fallback: `${MEDIA['cosmic-encore']}fallback.webp`,
};

function preferImages() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
    || (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent));
}

/** Check decoded video alpha before showing it; fall back through transparent image formats. */
export function RoomGiftAnimation({ giftId, onFinish }: { giftId: AnimatedGiftId; onFinish: () => void }) {
  const duration = DURATION[giftId];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [mode, setMode] = useState<'checking' | 'video' | 'webp' | 'apng' | 'still'>(reduced ? 'still' : preferImages() ? 'webp' : 'checking');
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
  return <div className="spirit-overlay" aria-hidden="true" data-testid={`${giftId}-animation`}>
    {(mode === 'checking' || mode === 'video') ? (
      <video src={`${MEDIA[giftId]}animation.webm`} autoPlay muted playsInline preload="auto"
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
      alt="" onLoad={start} onError={() => { if (mode === 'webp') setMode('apng'); else if (mode === 'apng') setMode('still'); else finish(); }} />}
  </div>;
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

  return <div className="cosmic-encore-overlay" aria-hidden="true" data-testid="cosmic-encore-animation">
    {fallback ? (
      <img className={`cosmic-encore-media${fadingOut ? ' is-fading-out' : ''}`} src={cosmicEncoreMedia.fallback} alt=""
        onAnimationEnd={event => { if (event.animationName === 'cosmic-encore-fade-out') finish(); }} />
    ) : (
      <video ref={videoRef} className={`cosmic-encore-media${fadingOut ? ' is-fading-out' : ''}`}
        src={cosmicEncoreMedia.animation} poster={cosmicEncoreMedia.fallback}
        autoPlay muted playsInline preload="auto" onEnded={() => setFadingOut(true)}
        onAnimationEnd={event => { if (event.animationName === 'cosmic-encore-fade-out') finish(); }} />
    )}
  </div>;
}
