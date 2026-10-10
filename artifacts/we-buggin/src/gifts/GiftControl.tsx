import { useEffect, useRef, useState } from 'react';
import './gifts.css';

const ASSET_BASE = `${import.meta.env.BASE_URL}gift-control/`;
const REPLAY_INTERVAL_MS = 30_000;
const ANIMATION_DURATION_MS = 6_100;

type PlaybackMode = 'checking' | 'video' | 'webp' | 'still';

function preferImageAnimation() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
    || (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent));
}

export function GiftControl({
  onClick,
  label = 'Send a gift',
}: {
  onClick: () => void;
  label?: string;
}) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [mode, setMode] = useState<PlaybackMode>(
    reduceMotion ? 'still' : preferImageAnimation() ? 'webp' : 'checking',
  );
  const [imageCycle, setImageCycle] = useState(0);
  const [imagePlaying, setImagePlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageEndTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (mode === 'video') {
      const video = videoRef.current;
      if (!video) return;
      const replay = async () => {
        if (document.hidden || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        try {
          video.currentTime = 0;
          await video.play();
        } catch {
          setMode('webp');
        }
      };
      const onVisibilityChange = () => {
        if (document.hidden) video.pause();
        else void replay();
      };
      void replay();
      const interval = window.setInterval(() => void replay(), REPLAY_INTERVAL_MS);
      document.addEventListener('visibilitychange', onVisibilityChange);
      return () => {
        window.clearInterval(interval);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        video.pause();
      };
    }

    if (mode === 'webp') {
      const replay = () => {
        if (document.hidden) return;
        setImageCycle(cycle => cycle + 1);
        setImagePlaying(true);
        if (imageEndTimer.current !== undefined) window.clearTimeout(imageEndTimer.current);
        imageEndTimer.current = window.setTimeout(() => setImagePlaying(false), ANIMATION_DURATION_MS);
      };
      const onVisibilityChange = () => {
        if (document.hidden) {
          setImagePlaying(false);
          if (imageEndTimer.current !== undefined) window.clearTimeout(imageEndTimer.current);
        } else {
          replay();
        }
      };
      replay();
      const interval = window.setInterval(replay, REPLAY_INTERVAL_MS);
      document.addEventListener('visibilitychange', onVisibilityChange);
      return () => {
        window.clearInterval(interval);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        if (imageEndTimer.current !== undefined) window.clearTimeout(imageEndTimer.current);
      };
    }

    return;
  }, [mode]);

  const verifyVideoAlpha = (video: HTMLVideoElement) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Video alpha check unavailable');
      context.drawImage(video, 0, 0, 8, 8, 0, 0, 1, 1);
      if (context.getImageData(0, 0, 1, 1).data[3]! > 8) throw new Error('Transparent video not supported');
      setMode('video');
    } catch {
      setMode('webp');
    }
  };

  return (
    <button
      type="button"
      className="gift-framework gift-control"
      onClick={onClick}
      aria-label={label}
      data-testid="button-open-gift-bag"
    >
      <span className="gift-control-media" aria-hidden="true">
        {(mode === 'checking' || mode === 'video') && (
          <video
            ref={videoRef}
            src={`${ASSET_BASE}gift-box.webm`}
            poster={`${ASSET_BASE}gift-box-poster.png`}
            muted
            playsInline
            preload="auto"
            className="gift-control-animation"
            style={{ visibility: mode === 'video' ? 'visible' : 'hidden' }}
            onLoadedData={event => {
              if (mode === 'checking') verifyVideoAlpha(event.currentTarget);
            }}
            onError={() => setMode('webp')}
          />
        )}
        {mode === 'checking' && (
          <img className="gift-control-animation" src={`${ASSET_BASE}gift-box-poster.png`} alt="" />
        )}
        {mode === 'still' && (
          <img className="gift-control-animation" src={`${ASSET_BASE}gift-box-poster.png`} alt="" />
        )}
        {mode === 'webp' && (
          <img
            key={imageCycle}
            className="gift-control-animation"
            src={`${ASSET_BASE}${imagePlaying ? 'gift-box.webp' : 'gift-box-poster.png'}`}
            alt=""
          />
        )}
      </span>
    </button>
  );
}
