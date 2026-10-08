import { useEffect, useReducer, useRef, useState } from 'react';
import { PROMO_VIDEOS, advancePlaylist, initialPlaylistState } from './promo-playlist';

const BUFFER_TIMEOUT_MS = 20_000;

export function PromoBackground({ soundOn, onUnavailableChange }: {
  soundOn: boolean; onUnavailableChange: (unavailable: boolean) => void;
}) {
  const [state, dispatch] = useReducer(
    (s: ReturnType<typeof initialPlaylistState>, event: Parameters<typeof advancePlaylist>[2]) =>
      advancePlaylist(s, PROMO_VIDEOS.length, event),
    PROMO_VIDEOS.length, initialPlaylistState,
  );
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const video = useRef<HTMLVideoElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = PROMO_VIDEOS[state.index];
  const clearBufferTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const fail = () => dispatch({ type: 'failed', index: state.index, run: state.run });
  const watchBuffer = () => {
    clearBufferTimer();
    const el = video.current;
    // A stalled download isn't a stalled player if there is still buffered video.
    if (el && !document.hidden && !reduced && !state.stopped && el.readyState < 3)
      timer.current = setTimeout(() => {
        if (!document.hidden && video.current === el && el.readyState < 3) fail();
      }, BUFFER_TIMEOUT_MS);
  };

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(media.matches);
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  useEffect(() => { onUnavailableChange(reduced || state.stopped); }, [reduced, state.stopped, onUnavailableChange]);

  useEffect(() => {
    const el = video.current;
    if (!el || reduced || state.stopped) return;
    let disposed = false;
    const resume = () => {
      if (document.hidden) { clearBufferTimer(); el.pause(); return; }
      watchBuffer();
      void el.play().catch((error: unknown) => {
        // Switching elements or hiding the page can abort play without a bad clip.
        if (disposed || document.hidden || (error instanceof DOMException && error.name === 'AbortError')) return;
        fail();
      });
    };
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => {
      disposed = true;
      clearBufferTimer();
      document.removeEventListener('visibilitychange', resume);
      el.pause();
    };
  }, [state.run, reduced, state.stopped]);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    el.muted = !soundOn;
    if (soundOn && !document.hidden && !reduced && !state.stopped)
      void el.play().catch((error: unknown) => {
        if (!document.hidden && !(error instanceof DOMException && error.name === 'AbortError')) fail();
      });
  }, [soundOn]);

  return <div className="promo-background" aria-hidden="true" data-testid="promo-background"
    data-playlist-index={state.index} data-unavailable={reduced || state.stopped}>
    <style>{`
      .promo-background{position:absolute;inset:0;overflow:hidden;pointer-events:none;isolation:isolate;background:#050505}
      .promo-background video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;z-index:1;pointer-events:none}
      .promo-background:after{content:"";position:absolute;inset:0;background:rgba(0,0,0,.40);z-index:2;pointer-events:none}
    `}</style>
    {/* Keep the same media element so a user's sound permission survives clip changes on phones. */}
    {!reduced && !state.stopped && active && <video ref={video}
      data-testid="promo-video" src={`${import.meta.env.BASE_URL}promo-videos/${active.file}`}
      autoPlay muted={!soundOn} playsInline preload="metadata"
      onEnded={() => dispatch({ type: 'ended', index: state.index, run: state.run })}
      onError={fail} onWaiting={watchBuffer} onStalled={watchBuffer}
      onPlaying={clearBufferTimer} onCanPlay={clearBufferTimer} />}
  </div>;
}
