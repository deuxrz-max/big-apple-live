import { useEffect, useRef, useState } from 'react';
import { loadYoutubeApi, type YtPlayer } from './BeamTv';

type PreviewPlayer = YtPlayer & {
  pauseVideo?: () => void;
  getDuration?: () => number;
  getVideoData?: () => { isLive?: boolean };
};
type PreviewState = 'poster' | 'loading' | 'playing' | 'blocked' | 'unavailable';

export type ChannelPreviewProps = {
  videoId: string | null | undefined;
  title?: string | null;
  startedAtMs?: number | null;
  serverNowMs?: number | null;
  slug: string;
};

/** Seconds into the shared programme, using the server clock offset. */
export function previewPositionSeconds(startedAtMs: number | null | undefined, serverOffsetMs: number, nowMs = Date.now()) {
  return typeof startedAtMs === 'number' ? Math.max(0, (nowMs + serverOffsetMs - startedAtMs) / 1000) : null;
}

/**
 * Muted, decorative moving preview of a channel's current video. It is
 * pointer-events:none so the surrounding channel link always receives taps.
 * Plays only while on screen and the page is visible; never unmutes.
 */
export function ChannelPreview({ videoId, title, startedAtMs, serverNowMs, slug }: ChannelPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PreviewPlayer | null>(null);
  const readyRef = useRef(false);
  const inViewRef = useRef(false);
  const offsetRef = useRef(typeof serverNowMs === 'number' ? serverNowMs - Date.now() : 0);
  const startedRef = useRef(startedAtMs ?? null);
  const syncedRef = useRef(false);
  const [state, setState] = useState<PreviewState>('poster');
  const [wanted, setWanted] = useState(false);

  useEffect(() => {
    if (typeof serverNowMs === 'number') offsetRef.current = serverNowMs - Date.now();
  }, [serverNowMs]);

  useEffect(() => {
    if (startedRef.current !== (startedAtMs ?? null)) { startedRef.current = startedAtMs ?? null; syncedRef.current = false; }
  }, [startedAtMs]);

  const apply = () => {
    const p = playerRef.current;
    if (!p || !readyRef.current) return;
    try {
      p.mute();
      if (inViewRef.current && document.visibilityState === 'visible') p.playVideo();
      else { syncedRef.current = false; p.pauseVideo?.(); }
    } catch { /* player may be unloading */ }
  };

  // Visibility gating: IntersectionObserver plus page visibility.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !videoId) return;
    const update = () => {
      const visible = inViewRef.current && document.visibilityState === 'visible';
      if (visible) setWanted(true);
      apply();
    };
    const io = new IntersectionObserver((entries) => {
      inViewRef.current = entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.35);
      update();
    }, { threshold: 0.35 });
    io.observe(el);
    document.addEventListener('visibilitychange', update);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', update); inViewRef.current = false; };
  }, [videoId]);

  // Player lifecycle: created on first visibility, destroyed on video change/unmount.
  useEffect(() => {
    const host = hostRef.current;
    if (!videoId || !wanted || !host) { setState(videoId ? 'poster' : 'unavailable'); return; }
    let active = true;
    let created: PreviewPlayer | null = null;
    let blockedTimer: number | undefined;
    syncedRef.current = false;
    setState('loading');
    const syncPosition = (p: PreviewPlayer) => {
      if (syncedRef.current) return;
      syncedRef.current = true;
      const desired = previewPositionSeconds(startedRef.current, offsetRef.current);
      if (desired === null) return;
      // Live YouTube streams can report a large finite duration (DVR window).
      // Seeking a room-relative timestamp there would rewind away from live TV.
      try { if (p.getVideoData?.().isLive) return; } catch { return; }
      let duration = 0;
      try { duration = p.getDuration?.() ?? 0; } catch { duration = 0; }
      if (Number.isFinite(duration) && duration > 0 && desired < duration - 2) {
        try { p.seekTo(desired, true); } catch { /* live or unseekable: keep live edge */ }
      }
    };
    void loadYoutubeApi().then((YT) => {
      if (!active) return;
      const target = document.createElement('div');
      host.replaceChildren(target);
      created = new YT.Player(target, {
        width: '100%', height: '100%', videoId,
        playerVars: { autoplay: 0, mute: 1, playsinline: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, cc_load_policy: 0, iv_load_policy: 3, enablejsapi: 1, origin: window.location.origin },
        events: {
          onReady: (e) => {
            if (!active) return;
            readyRef.current = true;
            try { e.target.mute(); } catch { /* ignore */ }
            apply();
            blockedTimer = window.setTimeout(() => {
              if (!active || !created) return;
              try {
                const s = created.getPlayerState();
                if ((s === -1 || s === 5) && inViewRef.current && document.visibilityState === 'visible') setState('blocked');
              } catch { /* ignore */ }
            }, 3_000);
          },
          onStateChange: (e) => {
            if (!active) return;
            if (e.data === 1) {
              try { e.target.mute(); } catch { /* ignore */ }
              if (!inViewRef.current || document.visibilityState !== 'visible') {
                try { (e.target as PreviewPlayer).pauseVideo?.(); } catch { /* unloading */ }
                syncedRef.current = false;
                return;
              }
              syncPosition(e.target as PreviewPlayer);
              setState('playing');
            }
          },
          onError: () => { if (active) setState('unavailable'); },
        },
      }) as PreviewPlayer;
      playerRef.current = created;
    }).catch(() => { if (active) setState('unavailable'); });
    return () => {
      active = false;
      readyRef.current = false;
      if (blockedTimer !== undefined) window.clearTimeout(blockedTimer);
      if (playerRef.current === created) playerRef.current = null;
      try { created?.stopVideo(); } catch { /* ignore */ }
      try { created?.destroy(); } catch { /* ignore */ }
      host.replaceChildren();
    };
  }, [videoId, wanted]);

  // Stale server update while the same video plays: re-sync once (VOD only).
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !readyRef.current) return;
    try {
      if (p.getPlayerState() !== 1) return;
      if (p.getVideoData?.().isLive) return;
      const desired = previewPositionSeconds(startedAtMs, offsetRef.current);
      const duration = p.getDuration?.() ?? 0;
      if (desired !== null && Number.isFinite(duration) && duration > 0 && desired < duration - 2 && Math.abs(desired - p.getCurrentTime()) > 4) p.seekTo(desired, true);
      syncedRef.current = true;
    } catch { /* live or unloading */ }
  }, [startedAtMs, serverNowMs]);

  const poster = videoId ? `https://img.youtube.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : null;
  const label = !videoId ? 'Intermission' : state === 'blocked' ? 'Preview paused' : state === 'unavailable' ? 'Preview unavailable' : state === 'playing' ? null : 'Loading preview';
  return (
    <div ref={rootRef} className={`rc-preview is-${state}`} aria-hidden="true" data-testid={`preview-channel-${slug}`} data-state={state} title={title ?? undefined}>
      {poster && state !== 'playing' && <img className="rc-preview-poster" src={poster} alt="" loading="lazy" />}
      <div ref={hostRef} className="rc-preview-player" />
      {label && <span className="rc-preview-status" data-testid={`status-preview-${slug}`}>{label}</span>}
    </div>
  );
}
