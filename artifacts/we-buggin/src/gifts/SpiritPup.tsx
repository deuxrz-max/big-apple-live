import { useEffect, useRef, useState } from 'react';
import { GiftIcon } from '@/social/common';
export const SPIRIT_MEDIA = `${import.meta.env.BASE_URL}api/gift-media/spirit-pup/v1/`;

export function SpiritIcon() {
  const [failed, setFailed] = useState(false);
  return failed ? <GiftIcon id="spirit-pup" /> : <img className="spirit-gift-icon" src={`${SPIRIT_MEDIA}icon-small.png`} width={64} height={64} alt="" aria-hidden="true" onError={() => setFailed(true)} />;
}

function preferImages() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
    || (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent));
}
/** A checked alpha channel prevents a supported-but-opaque video from ever showing a box. */
export function SpiritAnimation({ onFinish }: { onFinish: () => void }) {
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
    timer.current = setTimeout(finish, 4000);
  };
  useEffect(() => {
    loadingTimer.current = setTimeout(finish, 10000);
    return () => { if (loadingTimer.current) clearTimeout(loadingTimer.current); if (timer.current) clearTimeout(timer.current); };
  }, []);
  return <div className="spirit-overlay" aria-hidden="true" data-testid="spirit-animation">
    {(mode === 'checking' || mode === 'video') ? (
      <video src={`${SPIRIT_MEDIA}animation.webm`} autoPlay muted playsInline preload="auto"
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
    ) : <img src={`${SPIRIT_MEDIA}${mode === 'webp' ? 'animation.webp' : mode === 'apng' ? 'animation.png' : 'icon.png'}`}
      alt="" onLoad={start} onError={() => { if (mode === 'webp') setMode('apng'); else if (mode === 'apng') setMode('still'); else finish(); }} />}
  </div>;
}
