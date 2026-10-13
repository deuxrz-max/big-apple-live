import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { UniversityVideoBeamTvState, UniversityVideoBeamTvSearchResponse } from "@workspace/api-client-react";

type PlayerErrorEvent = { data: number };
type PlayerReadyEvent = { target: YtPlayer };
type YtPlayer = {
  destroy(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setVolume(volume: number): void;
  playVideo(): void;
  loadVideoById(input: { videoId: string; startSeconds?: number }): void;
  loadPlaylist(input:
    | { playlist: string[]; index?: number; startSeconds?: number }
    | { list: string; listType: "playlist"; index?: number; startSeconds?: number }): void;
  setLoop(loop: boolean): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getVideoData(): { video_id?: string };
  unloadModule(moduleName: string): void;
};
type YtNamespace = {
  Player: new (target: HTMLElement, options: {
    width?: string;
    height?: string;
    videoId?: string;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: (event: PlayerReadyEvent) => void;
      onError?: (event: PlayerErrorEvent) => void;
    };
  }) => YtPlayer;
};

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YtNamespace> | null = null;
function loadYoutubeApi(): Promise<YtNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<YtNamespace>((resolve, reject) => {
    const priorReady = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => reject(new Error("YouTube player timed out.")), 15_000);
    window.onYouTubeIframeAPIReady = () => {
      priorReady?.();
      window.clearTimeout(timeout);
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube player is unavailable."));
    };
    let script = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("YouTube player failed to load."));
      };
      document.head.appendChild(script);
    }
  }).catch(error => {
    youtubeApiPromise = null;
    throw error;
  });
  return youtubeApiPromise;
}

function positionAt(startedAtMs: number | null, serverOffsetMs: number) {
  return startedAtMs === null ? 0 : Math.max(0, (Date.now() + serverOffsetMs - startedAtMs) / 1000);
}

function countdown(breakEndsAtMs: number, now: number) {
  const totalSeconds = Math.max(0, Math.ceil((breakEndsAtMs - now) / 1_000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function isAutomaticTopicQueue(tv: UniversityVideoBeamTvState) {
  return tv.sourceType === "search"
    && tv.sourceValue === tv.defaultSearch
    && !tv.skipVotingEnabled;
}

function isCnnLiveStream(tv: UniversityVideoBeamTvState) {
  const metadata = tv.videoMetadata.find(video => video.videoId === tv.currentVideoId);
  const normalizedTitle = metadata?.title.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
  return metadata?.channelTitle?.trim().toLocaleLowerCase("en-US") === "cnn"
    && normalizedTitle === "cnn headlines 24 7 live news";
}

export type BeamTvHandle = {
  activateSoundFromUserGesture: () => boolean;
};

type BeamTvProps = {
  roomName: string;
  tv: UniversityVideoBeamTvState;
  search: (query: string) => Promise<UniversityVideoBeamTvSearchResponse>;
};

export const BeamTv = forwardRef<BeamTvHandle, BeamTvProps>(function BeamTv({
  roomName,
  tv,
  search,
}, ref) {
  const playerHost = useRef<HTMLDivElement>(null);
  const player = useRef<YtPlayer | null>(null);
  const tvRef = useRef(tv);
  const serverClockOffsetMs = useRef(tv.serverNowMs - Date.now());
  const autoSearchRef = useRef("");
  const soundUnlockedRef = useRef(false);
  const roomGestureSeenRef = useRef(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [searchUnavailable, setSearchUnavailable] = useState(false);
  const [playerUnavailable, setPlayerUnavailable] = useState(false);
  const [soundHintDismissed, setSoundHintDismissed] = useState(false);
  const [now, setNow] = useState(Date.now());
  tvRef.current = tv;

  const searchQuery = tv.defaultSearch.trim();
  const queueKey = tv.queue.join("|");
  const videoIsPlaying = tv.enabled
    && (Boolean(tv.currentVideoId) || Boolean(tv.playlistId))
    && tv.breakEndsAtMs === null;

  const requestSound = useCallback((instance: YtPlayer) => {
    try {
      instance.unMute();
      instance.setVolume(100);
      instance.playVideo();
      window.setTimeout(() => {
        try {
          if (player.current === instance && !instance.isMuted()) {
            soundUnlockedRef.current = true;
          }
        } catch { /* keep the sound hint visible if the player cannot report its state */ }
      }, 180);
      return true;
    } catch {
      return false;
    }
  }, []);

  const activateSoundFromUserGesture = useCallback(() => {
    roomGestureSeenRef.current = true;
    if (videoIsPlaying) setSoundHintDismissed(true);
    if (soundUnlockedRef.current) return true;
    const instance = player.current;
    return instance && videoIsPlaying ? requestSound(instance) : false;
  }, [requestSound, videoIsPlaying]);

  useImperativeHandle(ref, () => ({
    activateSoundFromUserGesture,
  }), [activateSoundFromUserGesture]);

  useEffect(() => {
    serverClockOffsetMs.current = tv.serverNowMs - Date.now();
    setNow(tv.serverNowMs);
  }, [tv.serverNowMs]);

  useEffect(() => {
    if (tv.breakEndsAtMs === null) return;
    const timer = window.setInterval(() => setNow(Date.now() + serverClockOffsetMs.current), 1_000);
    return () => window.clearInterval(timer);
  }, [tv.breakEndsAtMs]);

  // A public room's name is the server-approved search query; this only asks the
  // server to initialize its shared queue. The API key never reaches this client.
  useEffect(() => {
    const needsDefaultQueue = tv.enabled && tv.sourceType === "search"
      && tv.sourceValue === tv.defaultSearch && tv.queue.length === 0 && !tv.currentVideoId;
    if (!needsDefaultQueue || !searchQuery) {
      if (!needsDefaultQueue) setSearchUnavailable(false);
      return;
    }
    if (!tv.searchAvailable) {
      setSearchUnavailable(true);
      return;
    }
    if (autoSearchRef.current === searchQuery) return;
    autoSearchRef.current = searchQuery;
    setSearchUnavailable(false);
    let active = true;
    void search(searchQuery).catch(() => {
      if (active) setSearchUnavailable(true);
    });
    return () => { active = false; };
  }, [
    search,
    searchQuery,
    tv.currentVideoId,
    tv.defaultSearch,
    tv.enabled,
    tv.searchAvailable,
    tv.sourceType,
    tv.sourceValue,
    tv.queue.length,
  ]);

  useEffect(() => {
    if (!videoIsPlaying || (!tv.currentVideoId && !tv.playlistId) || !playerHost.current) return;
    let active = true;
    let created: YtPlayer | null = null;
    const stableHost = playerHost.current;
    setPlayerReady(false);
    setPlayerUnavailable(false);

    void loadYoutubeApi().then(YT => {
      if (!active) return;
      const target = document.createElement("div");
      target.className = "ur-tv-player-target";
      stableHost.replaceChildren(target);
      const current = tvRef.current;
      created = new YT.Player(target, {
        width: "100%",
        height: "100%",
        ...(current.currentVideoId ? { videoId: current.currentVideoId } : {}),
        playerVars: {
          autoplay: 1,
          mute: 1,
          playsinline: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          cc_load_policy: 0,
          iv_load_policy: 3,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: event => {
            if (!active) return;
            if (!soundUnlockedRef.current) {
              event.target.mute();
              event.target.setVolume(0);
            }
            const latest = tvRef.current;
            if (isAutomaticTopicQueue(latest) && latest.currentVideoId) {
              const liveStream = isCnnLiveStream(latest);
              event.target.loadVideoById(liveStream
                ? { videoId: latest.currentVideoId }
                : {
                  videoId: latest.currentVideoId,
                  startSeconds: positionAt(latest.startedAtMs, serverClockOffsetMs.current),
                });
            } else if (latest.queue.length) {
              event.target.setLoop(true);
              event.target.loadPlaylist({
                playlist: latest.queue,
                index: Math.max(0, latest.queue.indexOf(latest.currentVideoId ?? "")),
                startSeconds: positionAt(latest.startedAtMs, serverClockOffsetMs.current),
              });
            } else if (latest.playlistId) {
              event.target.setLoop(true);
              event.target.loadPlaylist({
                list: latest.playlistId,
                listType: "playlist",
                index: 0,
                startSeconds: positionAt(latest.startedAtMs, serverClockOffsetMs.current),
              });
            } else if (latest.currentVideoId) {
              event.target.loadVideoById({
                videoId: latest.currentVideoId,
                startSeconds: positionAt(latest.startedAtMs, serverClockOffsetMs.current),
              });
            }
            try { event.target.unloadModule("captions"); } catch { /* some embeds omit the captions module */ }
            if (soundUnlockedRef.current || roomGestureSeenRef.current) requestSound(event.target);
            setPlayerReady(true);
          },
          onError: () => {
            if (active) setPlayerUnavailable(true);
          },
        },
      });
      player.current = created;
    }).catch(() => {
      if (active) setPlayerUnavailable(true);
    });

    return () => {
      active = false;
      if (player.current === created) player.current = null;
      try { created?.destroy(); } catch { /* player may already have unloaded */ }
      stableHost.replaceChildren();
    };
  }, [requestSound, tv.currentVideoId, tv.playlistId, queueKey, tv.breakEndsAtMs, tv.enabled, videoIsPlaying]);

  // The server's startedAt timestamp is authoritative for everyone in the room.
  useEffect(() => {
    if (!playerReady) return;
    const interval = window.setInterval(() => {
      const current = tvRef.current;
      const instance = player.current;
      if (!current.enabled || !current.currentVideoId || current.breakEndsAtMs !== null || !instance) return;
      const desired = positionAt(current.startedAtMs, serverClockOffsetMs.current);
      const liveStream = isCnnLiveStream(current);
      if (instance.getVideoData()?.video_id !== current.currentVideoId) {
        instance.loadVideoById(liveStream
          ? { videoId: current.currentVideoId }
          : { videoId: current.currentVideoId, startSeconds: desired });
        if (soundUnlockedRef.current) {
          requestSound(instance);
        } else {
          instance.mute();
          instance.setVolume(0);
        }
      } else if (!liveStream && Math.abs(instance.getCurrentTime() - desired) > 5) {
        instance.seekTo(desired, true);
        instance.playVideo();
        if (!soundUnlockedRef.current) {
          instance.mute();
          instance.setVolume(0);
        }
      }
    }, 4_000);
    return () => window.clearInterval(interval);
  }, [playerReady, requestSound]);

  const hasPlayableVideo = videoIsPlaying && !searchUnavailable && !playerUnavailable;
  return (
    <section className="ur-tv-section" aria-label={`Beam TV for ${roomName}`}>
      <div className="ur-tv-frame">
        {hasPlayableVideo ? (
          <>
            <div className="ur-tv-player" ref={playerHost} />
            {!soundHintDismissed && (
              <div className="ur-tv-sound-hint" role="status">Tap anywhere for sound</div>
            )}
            {!playerReady && (
              <div className="ur-tv-placeholder" role="status">Starting the room video…</div>
            )}
          </>
        ) : (
          <div className="ur-tv-placeholder" role="status">
            {tv.breakEndsAtMs !== null
              ? `Next video in ${countdown(tv.breakEndsAtMs, now)}`
              : tv.defaultSearch === "Series of the Day"
                ? "Today's series is being selected. It will appear here when available."
              : "A room-matched video will appear here when one is available."}
          </div>
        )}
      </div>
    </section>
  );
});
