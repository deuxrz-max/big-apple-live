import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { UniversityVideoBeamTvActionInput, UniversityVideoBeamTvState, UniversityVideoBeamTvSearchResponse } from "@workspace/api-client-react";
import { errMessage } from "@/lib/errors";

type PlayerStateEvent = { data: number };
type PlayerErrorEvent = { data: number };
type PlayerReadyEvent = { target: YtPlayer };
type PlaylistInput = { list: string; listType: "playlist"; index?: number; startSeconds?: number };
type VideoPlaylistInput = { playlist: string[]; index?: number; startSeconds?: number };
type YtPlayer = {
  destroy(): void;
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void;
  playVideo(): void;
  pauseVideo(): void;
  nextVideo(): void;
  loadVideoById(input: { videoId: string; startSeconds?: number }): void;
  loadPlaylist(input: PlaylistInput | VideoPlaylistInput): void;
  playVideoAt(index: number): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getVideoData(): { video_id?: string; title?: string; author?: string };
  getPlaylist(): string[];
  getPlaylistIndex(): number;
  setLoop(loop: boolean): void;
  getPlayerState(): number;
};
type YtNamespace = {
  Player: new (target: HTMLElement, options: {
    width?: string;
    height?: string;
    videoId?: string;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: (event: PlayerReadyEvent) => void;
      onStateChange?: (event: PlayerStateEvent) => void;
      onError?: (event: PlayerErrorEvent) => void;
    };
  }) => YtPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; CUED: number };
};

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YtNamespace> | null = null;
function loadYoutubeApi(): Promise<YtNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YtNamespace>((resolve, reject) => {
    const prior = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => reject(new Error("YouTube's player did not load. Check your connection and try again.")), 15_000);
    window.onYouTubeIframeAPIReady = () => {
      prior?.();
      window.clearTimeout(timeout);
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube's player could not start."));
    };
    let script = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("YouTube's player could not load."));
      };
      document.head.appendChild(script);
    }
  }).catch(error => {
    apiPromise = null;
    throw error;
  });
  return apiPromise!;
}

function youtubeUrlSource(input: string): { kind: "video"; videoId: string } | { kind: "playlist"; playlistId: string; initialVideoId?: string } | null {
  let url: URL;
  try { url = new URL(input); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const videoId = url.pathname.split("/").filter(Boolean)[0];
    return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? { kind: "video", videoId } : null;
  }
  if (!["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) return null;
  const playlistId = url.searchParams.get("list");
  const videoId = url.searchParams.get("v")
    ?? url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/)?.[1];
  if (playlistId && /^[A-Za-z0-9_-]{10,80}$/.test(playlistId)) {
    return {
      kind: "playlist",
      playlistId,
      ...(videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? { initialVideoId: videoId } : {}),
    };
  }
  return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? { kind: "video", videoId } : null;
}

function positionAt(startedAtMs: number | null) {
  return startedAtMs === null ? 0 : Math.max(0, (Date.now() - startedAtMs) / 1000);
}

export function BeamTv({
  roomName,
  isHost,
  tv,
  runAction,
  search,
  settingsOpen,
  closeSettings,
}: {
  roomName: string;
  isHost: boolean;
  tv: UniversityVideoBeamTvState;
  runAction: (input: UniversityVideoBeamTvActionInput) => Promise<UniversityVideoBeamTvState>;
  search: (query: string) => Promise<UniversityVideoBeamTvSearchResponse>;
  settingsOpen: boolean;
  closeSettings: () => void;
}) {
  const playerHost = useRef<HTMLDivElement>(null);
  const player = useRef<YtPlayer | null>(null);
  const tvRef = useRef(tv);
  const actionRef = useRef(runAction);
  const lastPublishedRef = useRef("");
  const lastMetadataPublishedRef = useRef("");
  const lastErrorRef = useRef("");
  const autoSearchRef = useRef("");
  const skipSequenceRef = useRef<number | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [sourceInput, setSourceInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [searchRetry, setSearchRetry] = useState(0);
  tvRef.current = tv;
  actionRef.current = runAction;
  const queueKey = tv.queue.join(",");

  const publishPlayerPosition = useCallback(async (target: YtPlayer, force = false) => {
    const current = tvRef.current;
    const defaultPlayback = current.sourceType === "search" && current.sourceValue === current.defaultSearch;
    if ((!isHost && !defaultPlayback) || !current.enabled) return;
    const videoData = target.getVideoData();
    const videoId = videoData.video_id;
    if (!videoId) return;
    const knownMetadata = current.videoMetadata.find(item => item.videoId === videoId);
    const videoMetadata = {
      videoId,
      title: knownMetadata?.title || videoData.title?.trim() || "YouTube video",
      channelTitle: knownMetadata?.channelTitle ?? videoData.author?.trim() ?? null,
      description: knownMetadata?.description ?? null,
    };
    const metadataSignature = `${videoId}:${videoMetadata.title}:${videoMetadata.channelTitle ?? ""}`;
    const queue = target.getPlaylist?.()?.filter(id => /^[A-Za-z0-9_-]{11}$/.test(id)).slice(0, 50) ?? [];
    if (!tvRef.current.queue.length && queue.length) {
      try {
        await actionRef.current({
          action: "publish-queue",
          queue,
          currentVideoId: videoId,
          videoMetadata,
        });
      } catch { /* playback publication below can still synchronize a single video */ }
    }
    const signature = `${videoId}:${Math.floor(target.getCurrentTime())}`;
    if (!force && videoId === tvRef.current.currentVideoId
      && metadataSignature === lastMetadataPublishedRef.current) return;
    lastPublishedRef.current = signature;
    lastMetadataPublishedRef.current = metadataSignature;
    const startedAtMs = Date.now() - Math.round(target.getCurrentTime() * 1000);
    try {
      await actionRef.current({
        action: "publish-playback", currentVideoId: videoId, startedAtMs, videoMetadata,
      });
    } catch { /* the next player event or room poll retries synchronization */ }
  }, [isHost]);

  useEffect(() => {
    if (skipSequenceRef.current === null) {
      skipSequenceRef.current = tv.skipSequence;
      return;
    }
    if (skipSequenceRef.current === tv.skipSequence) return;
    skipSequenceRef.current = tv.skipSequence;
    if (tv.sourceType === "playlist" && !tv.queue.length) player.current?.nextVideo();
  }, [tv.skipSequence, tv.sourceType, tv.queue.length]);

  useEffect(() => {
    const isDefaultSearch = tv.enabled && tv.sourceType === "search"
      && tv.sourceValue === tv.defaultSearch && tv.queue.length === 0 && !tv.currentVideoId;
    if (!isDefaultSearch) {
      autoSearchRef.current = "";
      return;
    }
    if (!tv.searchAvailable) return;
    const query = tv.defaultSearch;
    const key = `${query}:${tv.startedAtMs ?? "pending"}`;
    if (autoSearchRef.current === key) return;
    autoSearchRef.current = key;
    let active = true;
    let retryTimer: number | undefined;
    void search(query).catch(error => {
      if (!active) return;
      setLocalError(errMessage(error, "Room-matched Beam TV search could not load."));
      retryTimer = window.setTimeout(() => {
        autoSearchRef.current = "";
        setSearchRetry(value => value + 1);
      }, 60_000);
    });
    return () => {
      active = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [tv.enabled, tv.sourceType, tv.sourceValue, tv.defaultSearch, tv.queue.length,
    tv.currentVideoId, tv.searchAvailable, tv.startedAtMs, search, searchRetry]);

  useEffect(() => {
    const hasSource = Boolean(tv.currentVideoId || tv.playlistId);
    if (!tv.enabled || !hasSource || !playerHost.current) return;
    let active = true;
    let created: YtPlayer | null = null;
    const stableHost = playerHost.current;
    setPlayerReady(false);
    setSoundOn(false);
    setLocalError("");
    void loadYoutubeApi().then(YT => {
      if (!active || !stableHost) return;
      const target = document.createElement("div");
      target.className = "ur-tv-player-target";
      stableHost.replaceChildren(target);
      const playerVars: Record<string, string | number> = {
        autoplay: 1, mute: 1, playsinline: 1, controls: 0, rel: 0,
        enablejsapi: 1, origin: window.location.origin,
      };
      if (tv.sourceType === "playlist" && tv.playlistId && !tv.queue.length) {
        playerVars.listType = "playlist";
        playerVars.list = tv.playlistId;
      }
      created = new YT.Player(target, {
        width: "100%",
        height: "100%",
        ...(tv.currentVideoId ? { videoId: tv.currentVideoId } : {}),
        playerVars,
        events: {
          onReady: event => {
            if (!active) return;
            event.target.mute();
            event.target.setVolume(100);
            event.target.setLoop(true);
            const current = tvRef.current;
            if (current.sourceType === "playlist" && current.playlistId && !current.queue.length) {
              event.target.loadPlaylist({ listType: "playlist", list: current.playlistId });
            } else if (current.queue.length) {
              const index = Math.max(0, current.queue.indexOf(current.currentVideoId ?? current.queue[0]!));
              event.target.loadPlaylist({
                playlist: current.queue,
                index,
                startSeconds: positionAt(current.startedAtMs),
              });
            } else if (current.currentVideoId) {
              event.target.loadVideoById({
                videoId: current.currentVideoId,
                startSeconds: positionAt(current.startedAtMs),
              });
            }
            setPlayerReady(true);
          },
          onStateChange: event => {
            if (!active || !created) return;
            if (event.data === YT.PlayerState.PLAYING) void publishPlayerPosition(created);
          },
          onError: event => {
            if (!active) return;
            const failedId = created?.getVideoData()?.video_id ?? tvRef.current.currentVideoId ?? `error-${event.data}`;
            if (lastErrorRef.current === failedId) return;
            lastErrorRef.current = failedId;
            setLocalError("This YouTube video could not play. Skipping to the next one when available.");
            if (!created) return;
            const current = tvRef.current;
            if (current.queue.length > 1) {
              if (current.sourceType === "search" && current.sourceValue === current.defaultSearch) {
                const index = Math.max(0, current.queue.indexOf(failedId));
                const next = current.queue[(index + 1) % current.queue.length]!;
                void actionRef.current({
                  action: "publish-playback",
                  currentVideoId: next,
                  startedAtMs: Date.now(),
                }).catch(() => undefined);
              } else if (isHost) {
                void actionRef.current({ action: "skip" }).catch(() => undefined);
              }
            } else if (current.sourceType === "playlist") {
              created.nextVideo();
            }
          },
        },
      });
      player.current = created;
    }).catch(error => {
      if (active) setLocalError(errMessage(error, "YouTube's player could not load."));
    });
    return () => {
      active = false;
      player.current = null;
      if (created) {
        try { created.destroy(); } catch { /* player may already be gone */ }
      }
      stableHost?.replaceChildren();
    };
  }, [tv.enabled, tv.sourceType, tv.playlistId, tv.currentVideoId, publishPlayerPosition, isHost]);

  useEffect(() => {
    if (!tv.enabled || !playerReady || !player.current || !tv.currentVideoId) return;
    const instance = player.current;
    const currentId = instance.getVideoData()?.video_id;
    const targetPosition = positionAt(tv.startedAtMs);
    if (currentId !== tv.currentVideoId) {
      if (tv.queue.length) {
        const index = Math.max(0, tv.queue.indexOf(tv.currentVideoId));
        instance.loadPlaylist({ playlist: tv.queue, index, startSeconds: targetPosition });
      } else {
        instance.loadVideoById({ videoId: tv.currentVideoId, startSeconds: targetPosition });
      }
      if (!soundOn) instance.mute();
      return;
    }
    const drift = Math.abs(instance.getCurrentTime() - targetPosition);
    if (!isHost && drift > 5) {
      instance.seekTo(targetPosition, true);
      if (instance.getPlayerState() !== window.YT?.PlayerState.PLAYING) instance.playVideo();
    }
  }, [tv.enabled, tv.currentVideoId, tv.startedAtMs, queueKey, playerReady, soundOn, isHost, tv.queue]);

  useEffect(() => {
    const defaultPlayback = tv.sourceType === "search" && tv.sourceValue === tv.defaultSearch;
    if (!tv.enabled || isHost || defaultPlayback) return;
    const interval = window.setInterval(() => {
      const instance = player.current;
      const current = tvRef.current;
      if (!instance || !current.enabled || !current.currentVideoId) return;
      const desired = positionAt(current.startedAtMs);
      if (instance.getVideoData()?.video_id !== current.currentVideoId) {
        if (current.queue.length) {
          instance.loadPlaylist({
            playlist: current.queue,
            index: Math.max(0, current.queue.indexOf(current.currentVideoId)),
            startSeconds: desired,
          });
        } else instance.loadVideoById({ videoId: current.currentVideoId, startSeconds: desired });
      } else if (Math.abs(instance.getCurrentTime() - desired) > 5) {
        instance.seekTo(desired, true);
        instance.playVideo();
      }
    }, 4_000);
    return () => window.clearInterval(interval);
  }, [tv.enabled, isHost]);

  useEffect(() => {
    const defaultPlayback = tv.sourceType === "search" && tv.sourceValue === tv.defaultSearch;
    if (!tv.enabled || (!isHost && !defaultPlayback)) return;
    const interval = window.setInterval(() => {
      if (player.current) void publishPlayerPosition(player.current, true);
    }, 4_000);
    return () => window.clearInterval(interval);
  }, [tv.enabled, tv.sourceType, tv.sourceValue, tv.defaultSearch, isHost, publishPlayerPosition]);

  const startTv = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setLocalError("");
    const raw = sourceInput.trim();
    try {
      const linked = raw ? youtubeUrlSource(raw) : null;
      if (raw && /^https?:\/\//i.test(raw) && !linked) {
        throw new Error("Paste a YouTube video or playlist link, or enter a search topic.");
      }
      if (linked?.kind === "video") {
        await runAction({
          action: "start",
          sourceType: "video",
          sourceValue: raw,
          queue: [linked.videoId],
          currentVideoId: linked.videoId,
        });
      } else if (linked?.kind === "playlist") {
        await runAction({
          action: "start",
          sourceType: "playlist",
          sourceValue: raw,
          playlistId: linked.playlistId,
          ...(linked.initialVideoId ? { currentVideoId: linked.initialVideoId } : {}),
        });
      } else {
        const query = raw || tv.defaultSearch;
        const result = await search(query);
        await runAction({
          action: "start",
          sourceType: "search",
          sourceValue: query,
          queue: result.videoIds,
          currentVideoId: result.videoIds[0],
          videoMetadata: result.videos[0],
        });
      }
      closeSettings();
    } catch (error) {
      setLocalError(errMessage(error, "Could not start Beam TV."));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setLocalError("");
    try {
      await runAction({ action: "stop" });
      closeSettings();
    } catch (error) {
      setLocalError(errMessage(error, "Could not turn Beam TV off."));
    } finally {
      setBusy(false);
    }
  };

  const resetToDefault = async () => {
    setBusy(true);
    setLocalError("");
    setSourceInput("");
    try {
      await runAction({ action: "reset" });
      closeSettings();
    } catch (error) {
      setLocalError(errMessage(error, "Could not restore this room's default video search."));
    } finally {
      setBusy(false);
    }
  };

  const toggleSound = () => {
    const instance = player.current;
    if (!instance) return;
    if (soundOn) {
      instance.mute();
      setSoundOn(false);
    } else {
      instance.unMute();
      instance.setVolume(100);
      instance.playVideo();
      setSoundOn(true);
    }
  };

  const skip = async () => {
    setLocalError("");
    try {
      await runAction({ action: "skip" });
    }
    catch (error) { setLocalError(errMessage(error, "Could not skip this video.")); }
  };

  const voteSkip = async () => {
    setLocalError("");
    try {
      await runAction({ action: "vote-skip" });
    } catch (error) {
      setLocalError(errMessage(error, "Could not record your skip vote."));
    }
  };

  const canAdvance = tv.queue.length > 1 || Boolean(tv.playlistId);
  const setVoting = async () => {
    setLocalError("");
    try {
      await runAction({
        action: "set-skip-voting",
        skipVotingEnabled: !tv.skipVotingEnabled,
      });
    } catch (error) {
      setLocalError(errMessage(error, "Could not update room skip voting."));
    }
  };

  return (
    <>
      {tv.enabled && (
        <section className="ur-tv-section" aria-label="Beam TV">
          <div className="ur-tv-frame">
            {tv.currentVideoId || tv.playlistId
              ? <div className="ur-tv-player" ref={playerHost} />
              : <div className="ur-tv-placeholder" role="status">
                {tv.searchAvailable
                  ? `Finding videos for ${roomName}…`
                  : "Room-matched YouTube search needs YOUTUBE_API_KEY."}
              </div>}
          </div>
          <div className="ur-tv-controls">
            <button type="button" className="ur-tv-control" onClick={toggleSound} disabled={!playerReady}>
              {soundOn ? "Mute TV sound" : "Tap for sound"}
            </button>
            <button
              type="button"
              className="ur-tv-control"
              onClick={() => void voteSkip()}
              disabled={!tv.skipVotingEnabled || tv.hasVotedToSkip || !canAdvance}
              aria-label={`Vote to skip this video. ${tv.skipVoteCount} of ${tv.skipVoteTotal} votes`}
            >
              {tv.hasVotedToSkip ? "Voted" : "Skip"} {tv.skipVoteCount}/{tv.skipVoteTotal}
            </button>
            {isHost && (
              <button type="button" className="ur-tv-control" onClick={() => void skip()} disabled={!canAdvance}>
                Next video
              </button>
            )}
          </div>
          {localError && <p className="ur-tv-error" role="status">{localError}</p>}
        </section>
      )}
      {settingsOpen && isHost && (
        <div className="ur-modal" onMouseDown={closeSettings}>
          <section className="ur-tv-dialog" role="dialog" aria-modal="true" aria-labelledby="ur-tv-title"
            onMouseDown={event => event.stopPropagation()}>
            <button type="button" className="ur-tv-close" aria-label="Close Beam TV settings"
              onClick={closeSettings}>×</button>
            <h2 id="ur-tv-title">Beam TV</h2>
            <p>Play an official YouTube video or playlist for everyone in this room.</p>
            <form onSubmit={event => void startTv(event)}>
              <label htmlFor="ur-tv-source">Search topic or paste a YouTube link</label>
              <input id="ur-tv-source" value={sourceInput} onChange={event => setSourceInput(event.target.value)}
                placeholder={`Search or paste a link · default: ${tv.defaultSearch}`} maxLength={160} />
              {!tv.searchAvailable && (
                <p className="ur-tv-note">Search needs YOUTUBE_API_KEY. Video and playlist links still work.</p>
              )}
              {localError && <p className="ur-tv-error" role="alert">{localError}</p>}
              <button type="submit" className="ur-tv-primary" disabled={busy}>{busy ? "Starting…" : "Start Beam TV"}</button>
            </form>
            <button type="button" className="ur-tv-control" disabled={busy} onClick={() => void resetToDefault()}>
              Reset to this room&apos;s default
            </button>
            <button type="button" className="ur-tv-control" disabled={busy} onClick={() => void setVoting()}>
              Turn skip voting {tv.skipVotingEnabled ? "off" : "on"}
            </button>
            {tv.enabled && (
              <button type="button" className="ur-tv-stop" disabled={busy} onClick={() => void turnOff()}>
                Turn Beam TV off
              </button>
            )}
          </section>
        </div>
      )}
    </>
  );
}

export function BeamTvToggle({ enabled, onClick, expanded }: {
  enabled: boolean;
  onClick: () => void;
  expanded: boolean;
}) {
  return (
    <button type="button" className={`ur-tv-open${enabled ? " is-on" : ""}`}
      aria-haspopup="dialog" aria-expanded={expanded} onClick={onClick}>
      Beam TV · {enabled ? "On" : "Off"}
    </button>
  );
}
