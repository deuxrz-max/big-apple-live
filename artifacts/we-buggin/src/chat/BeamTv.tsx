import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { UniversityVideoBeamTvState, UniversityVideoBeamTvSearchResponse } from "@workspace/api-client-react";
import {
  BEAM_TV_SYNC_CHECK_MS,
  shouldCorrectBeamTvDrift,
} from "./beam-tv-sync";
import { BEAM_TV_PLAYBACK_STATE_EVENT } from "./beam-tv-playback-events";
import { setBeamTvSoundMuted } from "./beam-audio-policy";

type PlayerErrorEvent = { data: number };
type PlayerReadyEvent = { target: YtPlayer };
type PlayerStateEvent = { data: number; target: YtPlayer };
type YtPlayer = {
  destroy(): void;
  stopVideo(): void;
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
  getPlayerState(): number;
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
      onStateChange?: (event: PlayerStateEvent) => void;
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
  setMicrophoneAudioMode: (microphoneEnabled: boolean) => boolean;
};

type BeamTvProps = {
  roomName: string;
  tv: UniversityVideoBeamTvState;
  microphoneEnabled: boolean;
  search: (query: string) => Promise<UniversityVideoBeamTvSearchResponse>;
  reportPlaybackFailure: (videoId: string, errorCode: number) => Promise<void>;
};

function sameQueue(a: string[], b: string[]) {
  return a === b || (a.length === b.length && a.every((videoId, index) => videoId === b[index]));
}

function currentVideoMetadata(tv: UniversityVideoBeamTvState) {
  return tv.videoMetadata.find(video => video.videoId === tv.currentVideoId) ?? null;
}

export function beamTvPropsEqual(previous: BeamTvProps, next: BeamTvProps) {
  const a = previous.tv;
  const b = next.tv;
  const previousMetadata = currentVideoMetadata(a);
  const nextMetadata = currentVideoMetadata(b);
  return previous.roomName === next.roomName
    && previous.search === next.search
    && previous.reportPlaybackFailure === next.reportPlaybackFailure
    && previous.microphoneEnabled === next.microphoneEnabled
    && a.enabled === b.enabled
    && a.currentVideoId === b.currentVideoId
    && a.playlistId === b.playlistId
    && a.startedAtMs === b.startedAtMs
    && a.breakEndsAtMs === b.breakEndsAtMs
    && a.serverNowMs === b.serverNowMs
    && a.defaultSearch === b.defaultSearch
    && a.sourceType === b.sourceType
    && a.sourceValue === b.sourceValue
    && a.skipVotingEnabled === b.skipVotingEnabled
    && sameQueue(a.queue, b.queue)
    && previousMetadata?.title === nextMetadata?.title
    && previousMetadata?.channelTitle === nextMetadata?.channelTitle;
}

export const BeamTv = memo(forwardRef<BeamTvHandle, BeamTvProps>(function BeamTv({
  roomName,
  tv,
  microphoneEnabled,
  search,
  reportPlaybackFailure,
}, ref) {
  const playerHost = useRef<HTMLDivElement>(null);
  const player = useRef<YtPlayer | null>(null);
  const loadedVideoId = useRef<string | null>(null);
  const lastSyncCorrectionAtMs = useRef(0);
  const tvRef = useRef(tv);
  const microphoneEnabledRef = useRef(microphoneEnabled);
  const serverClockOffsetMs = useRef(tv.serverNowMs - Date.now());
  const autoSearchRef = useRef("");
  const [searchRetryNonce, setSearchRetryNonce] = useState(0);
  const soundUnlockedRef = useRef(false);
  const roomGestureSeenRef = useRef(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [searchUnavailable, setSearchUnavailable] = useState(false);
  const [playerUnavailable, setPlayerUnavailable] = useState(false);
  const reportedFailureVideoId = useRef<string | null>(null);
  const lastFailureResetVideoId = useRef(tv.currentVideoId);
  const [soundHintDismissed, setSoundHintDismissed] = useState(false);
  const [now, setNow] = useState(Date.now());
  tvRef.current = tv;
  microphoneEnabledRef.current = microphoneEnabled;

  const searchQuery = tv.defaultSearch.trim();
  const videoIsPlaying = tv.enabled
    && (Boolean(tv.currentVideoId) || Boolean(tv.playlistId))
    && tv.breakEndsAtMs === null;

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(BEAM_TV_PLAYBACK_STATE_EVENT, { detail: videoIsPlaying }));
    return () => {
      window.dispatchEvent(new CustomEvent(BEAM_TV_PLAYBACK_STATE_EVENT, { detail: false }));
    };
  }, [videoIsPlaying]);

  const requestSound = useCallback((instance: YtPlayer) => {
    try {
      if (microphoneEnabledRef.current) {
        setBeamTvSoundMuted(instance, true);
        return false;
      }
      instance.unMute();
      instance.setVolume(100);
      if (instance.getPlayerState() !== 1) instance.playVideo();
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
    if (microphoneEnabledRef.current) {
      try {
        if (player.current) setBeamTvSoundMuted(player.current, true);
      } catch { /* keep the microphone/video split even if the iframe is unloading */ }
      return false;
    }
    if (soundUnlockedRef.current) return true;
    const instance = player.current;
    return instance && videoIsPlaying ? requestSound(instance) : false;
  }, [reportPlaybackFailure, requestSound, videoIsPlaying]);

  const setMicrophoneAudioMode = useCallback((enabled: boolean) => {
    roomGestureSeenRef.current = true;
    if (videoIsPlaying) setSoundHintDismissed(true);
    microphoneEnabledRef.current = enabled;
    soundUnlockedRef.current = !enabled;
    const instance = player.current;
    if (!instance) return true;
    try {
      setBeamTvSoundMuted(instance, enabled);
      return true;
    } catch {
      return false;
    }
  }, [videoIsPlaying]);

  useImperativeHandle(ref, () => ({
    activateSoundFromUserGesture,
    setMicrophoneAudioMode,
  }), [activateSoundFromUserGesture, setMicrophoneAudioMode]);

  useEffect(() => {
    const instance = player.current;
    if (!instance) return;
    try {
      if (microphoneEnabled) {
        setBeamTvSoundMuted(instance, true);
      } else if (soundUnlockedRef.current) {
        setBeamTvSoundMuted(instance, false);
      }
    } catch { /* the player may be closing during a room transition */ }
  }, [microphoneEnabled, playerReady]);

  useEffect(() => {
    serverClockOffsetMs.current = tv.serverNowMs - Date.now();
  }, [tv.serverNowMs, tv.currentVideoId, tv.startedAtMs, tv.breakEndsAtMs]);

  useEffect(() => {
    if (lastFailureResetVideoId.current === tv.currentVideoId) return;
    lastFailureResetVideoId.current = tv.currentVideoId;
    reportedFailureVideoId.current = null;
    setPlayerUnavailable(false);
  }, [tv.currentVideoId]);

  useEffect(() => {
    if (tv.breakEndsAtMs === null) return;
    const updateCountdown = () => setNow(Date.now() + serverClockOffsetMs.current);
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1_000);
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
    if (autoSearchRef.current === searchQuery) return;
    autoSearchRef.current = searchQuery;
    setSearchUnavailable(false);
    let active = true;
    let retryTimer: number | undefined;
    const retryLater = () => {
      retryTimer = window.setTimeout(() => {
        if (!active) return;
        autoSearchRef.current = "";
        setSearchRetryNonce(value => value + 1);
      }, 30_000);
    };
    void search(searchQuery).then(result => {
      if (!active) return;
      if (!result.videoIds.length) {
        setSearchUnavailable(true);
        retryLater();
      }
    }).catch(() => {
      if (!active) return;
      setSearchUnavailable(true);
      retryLater();
    });
    return () => {
      active = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [
    search,
    searchQuery,
    searchRetryNonce,
    tv.currentVideoId,
    tv.defaultSearch,
    tv.enabled,
    tv.sourceType,
    tv.sourceValue,
    tv.queue.length,
  ]);

  useEffect(() => {
    if (!videoIsPlaying || (!tv.currentVideoId && !tv.playlistId) || !playerHost.current) return;
    let active = true;
    let created: YtPlayer | null = null;
    let readyTimeout: number | undefined;
    let autoplayCheckTimer: number | undefined;
    const stableHost = playerHost.current;
    setPlayerReady(false);
    setPlayerUnavailable(false);
    setAutoplayBlocked(false);
    const checkMutedAutoplay = () => {
      if (autoplayCheckTimer !== undefined) window.clearTimeout(autoplayCheckTimer);
      autoplayCheckTimer = window.setTimeout(() => {
        if (!active || !created || !videoIsPlaying) return;
        try {
          const state = created.getPlayerState();
          if (state === -1 || state === 2) setAutoplayBlocked(true);
        } catch { /* the player may still be initializing */ }
      }, 2_500);
    };

    void loadYoutubeApi().then(YT => {
      if (!active) return;
      const target = document.createElement("div");
      target.className = "ur-tv-player-target";
      stableHost.replaceChildren(target);
      created = new YT.Player(target, {
        width: "100%",
        height: "100%",
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
            if (readyTimeout !== undefined) window.clearTimeout(readyTimeout);
            try {
              if (microphoneEnabledRef.current || !soundUnlockedRef.current) {
                setBeamTvSoundMuted(event.target, true);
              }
            } catch { /* continue initializing the player if sound control is unavailable */ }
            const latest = tvRef.current;
            if (isAutomaticTopicQueue(latest) && latest.currentVideoId) {
              const liveStream = isCnnLiveStream(latest);
              event.target.loadVideoById(liveStream
                ? { videoId: latest.currentVideoId }
                : {
                  videoId: latest.currentVideoId,
                  startSeconds: positionAt(latest.startedAtMs, serverClockOffsetMs.current),
                });
              loadedVideoId.current = latest.currentVideoId;
            } else if (latest.queue.length) {
              event.target.setLoop(true);
              event.target.loadPlaylist({
                playlist: latest.queue,
                index: Math.max(0, latest.queue.indexOf(latest.currentVideoId ?? "")),
                startSeconds: positionAt(latest.startedAtMs, serverClockOffsetMs.current),
              });
              loadedVideoId.current = latest.currentVideoId;
            } else if (latest.playlistId) {
              event.target.setLoop(true);
              event.target.loadPlaylist({
                list: latest.playlistId,
                listType: "playlist",
                index: 0,
                startSeconds: positionAt(latest.startedAtMs, serverClockOffsetMs.current),
              });
              loadedVideoId.current = latest.currentVideoId;
            } else if (latest.currentVideoId) {
              event.target.loadVideoById({
                videoId: latest.currentVideoId,
                startSeconds: positionAt(latest.startedAtMs, serverClockOffsetMs.current),
              });
              loadedVideoId.current = latest.currentVideoId;
            }
            lastSyncCorrectionAtMs.current = Date.now();
            try { event.target.unloadModule("captions"); } catch { /* some embeds omit the captions module */ }
            if (microphoneEnabledRef.current) {
              try { setBeamTvSoundMuted(event.target, true); } catch { /* player may be unloading */ }
            } else if (soundUnlockedRef.current || roomGestureSeenRef.current) {
              requestSound(event.target);
            }
            setPlayerReady(true);
            checkMutedAutoplay();
          },
          onError: event => {
            if (readyTimeout !== undefined) window.clearTimeout(readyTimeout);
            if (autoplayCheckTimer !== undefined) window.clearTimeout(autoplayCheckTimer);
            if (active) {
              setAutoplayBlocked(false);
              setPlayerUnavailable(true);
              const failedVideoId = tvRef.current.currentVideoId;
              if (failedVideoId && reportedFailureVideoId.current !== failedVideoId) {
                reportedFailureVideoId.current = failedVideoId;
                void reportPlaybackFailure(failedVideoId, Number(event.data)).catch(() => undefined);
              }
            }
          },
          onStateChange: event => {
            if (!active) return;
            if (event.data === 1) {
              if (autoplayCheckTimer !== undefined) window.clearTimeout(autoplayCheckTimer);
              setAutoplayBlocked(false);
            } else if (event.data === -1 || event.data === 2) {
              checkMutedAutoplay();
            }
          },
        },
      });
      player.current = created;
      const timedVideoId = tvRef.current.currentVideoId;
      readyTimeout = window.setTimeout(() => {
        if (!active || !timedVideoId || tvRef.current.currentVideoId !== timedVideoId) return;
        setPlayerUnavailable(true);
        if (reportedFailureVideoId.current !== timedVideoId) {
          reportedFailureVideoId.current = timedVideoId;
          void reportPlaybackFailure(timedVideoId, 101).catch(() => undefined);
        }
      }, 20_000);
    }).catch(() => {
      if (active) setPlayerUnavailable(true);
    });

    return () => {
      active = false;
      if (readyTimeout !== undefined) window.clearTimeout(readyTimeout);
      if (autoplayCheckTimer !== undefined) window.clearTimeout(autoplayCheckTimer);
      if (player.current === created) player.current = null;
      try { created?.stopVideo(); } catch { /* player may already be unloading */ }
      try { created?.destroy(); } catch { /* player may already have unloaded */ }
      loadedVideoId.current = null;
      stableHost.replaceChildren();
    };
  }, [requestSound, videoIsPlaying]);

  // Keep one iframe for the whole playback segment. Small drift is tolerated;
  // only sustained, meaningful drift is corrected, and never while buffering.
  useEffect(() => {
    if (!playerReady) return;
    const syncPlayback = () => {
      const current = tvRef.current;
      const instance = player.current;
      if (!current.enabled || !current.currentVideoId || current.breakEndsAtMs !== null || !instance) return;

      if (loadedVideoId.current !== current.currentVideoId) {
        const desired = positionAt(current.startedAtMs, serverClockOffsetMs.current);
        const liveStream = isCnnLiveStream(current);
        instance.loadVideoById(liveStream
          ? { videoId: current.currentVideoId }
          : { videoId: current.currentVideoId, startSeconds: desired });
        loadedVideoId.current = current.currentVideoId;
        lastSyncCorrectionAtMs.current = Date.now();
        if (microphoneEnabledRef.current) {
          try { setBeamTvSoundMuted(instance, true); } catch { /* player may be unloading */ }
        } else if (soundUnlockedRef.current) {
          requestSound(instance);
        } else {
          try { setBeamTvSoundMuted(instance, true); } catch { /* player may be unloading */ }
        }
        return;
      }

      if (isCnnLiveStream(current)) return;
      if (instance.getPlayerState() !== 1) return;
      const desired = positionAt(current.startedAtMs, serverClockOffsetMs.current);
      const driftSeconds = desired - instance.getCurrentTime();
      const nowMs = Date.now();
      const playerState = instance.getPlayerState();
      if (!shouldCorrectBeamTvDrift({
        driftSeconds,
        playerState,
        nowMs,
        lastCorrectionAtMs: lastSyncCorrectionAtMs.current,
      })) return;

      // Avoid forcing a new buffer read. The currently playing video continues
      // naturally; tiny differences are intentionally left alone.
      instance.seekTo(desired, false);
      lastSyncCorrectionAtMs.current = nowMs;
    };
    syncPlayback();
    const interval = window.setInterval(() => {
      syncPlayback();
    }, BEAM_TV_SYNC_CHECK_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") syncPlayback();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [playerReady, requestSound, reportPlaybackFailure, tv.currentVideoId, videoIsPlaying]);

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
            {playerReady && autoplayBlocked && (
              <button
                type="button"
                className="ur-tv-autoplay-hint"
                onPointerDown={event => event.stopPropagation()}
                onClick={event => {
                  event.stopPropagation();
                  try {
                    const instance = player.current;
                    if (!instance) return;
                    instance.mute();
                    instance.setVolume(0);
                    instance.playVideo();
                    setAutoplayBlocked(false);
                  } catch {
                    setAutoplayBlocked(true);
                  }
                }}
              >
                Tap to play
              </button>
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
}), beamTvPropsEqual);
