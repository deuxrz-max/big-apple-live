import { useEffect, useRef, useState } from 'react';
import './homepage-cauldron.css';

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
const WEBM_SRC = `${BASE}api/gift-media/system-cauldron/webm`;
const FALLBACK_SRC = `${BASE}api/gift-media/system-cauldron/safari`;

function needsImageFallback() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const appleMobile = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR/i.test(ua);
  if (appleMobile || safari) return true;
  return !document.createElement('video').canPlayType('video/webm; codecs="vp9"');
}

export function HomepageCauldron() {
  const [useImage, setUseImage] = useState(needsImageFallback);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || useImage || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) v.play().catch(() => {});
      else v.pause();
    });
    io.observe(v);
    return () => io.disconnect();
  }, [useImage]);

  return (
    <div className="hp-cauldron" data-testid="homepage-cauldron">
      {useImage ? (
        <img className="hp-cauldron-media" src={FALLBACK_SRC} alt="" aria-hidden="true" decoding="async" />
      ) : (
        <video
          ref={videoRef}
          className="hp-cauldron-media"
          data-testid="homepage-cauldron-video"
          src={WEBM_SRC}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-hidden="true"
          tabIndex={-1}
          onVolumeChange={(e) => { e.currentTarget.muted = true; }}
          onError={() => setUseImage(true)}
        />
      )}
    </div>
  );
}
