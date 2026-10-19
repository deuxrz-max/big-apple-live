import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Eye, Flag, FlipHorizontal, Mic, MicOff, Radio, Share2, Users, Video, X } from "lucide-react";
import { Link, useLocation } from "wouter";
import { type RemoteTrack } from "livekit-client";
import {
  getGetSocialBlocksQueryKey, getGetSocialMeQueryKey, getGetSocialPersonQueryKey,
  getLiveStreams, sendLiveStreamChatMessage, useGetSocialBlocks, useGetSocialMe,
  useGetSocialPerson, useSetSocialRelationship,
} from "@workspace/api-client-react";
import type { LiveStreamEntry, LiveStreamChatMessage } from "@workspace/api-client-react";
import { GiftBag } from "@/gifts/GiftBag";
import { GiftControl } from "@/gifts/GiftControl";
import { GiftComboPlayer, type GiftComboNotice } from "@/gifts/GiftComboPlayer";
import { appendUniqueGiftEvents, finishGiftQueueItem } from "@/gifts/gift-combo-policy";
import { SafetyReportDialog } from "@/safety/SafetyReportDialog";
import { ShinyName } from "@/components/ShinyName";
import {
  hostLiveSession, leaveViewerLiveSession, viewerLiveSession,
  type HostLiveSnapshot, type ViewerLiveSnapshot,
} from "./liveSessionController";
import "./live-stream.css";

type GiftNotice = GiftComboNotice & {
  senderUsername: string;
  giftName: string;
  quantity: number;
  cost: number;
};
type ActionTarget = { username: string; displayName: string; displayNameColor?: string; displayNameTierIndex?: number };
type ReportTarget = {
  targetType: "user" | "message" | "stream";
  targetUsername: string;
  streamId?: string;
  messageId?: string;
  messageText?: string;
};

const base = import.meta.env.BASE_URL;
const liveEndpoint = (streamId: string, suffix: string) =>
  `${base}api/account/live-streams/${encodeURIComponent(streamId)}/${suffix}`;

function useHostSnapshot() {
  return useSyncExternalStore(hostLiveSession.subscribe, hostLiveSession.getSnapshot, hostLiveSession.getSnapshot);
}

function useViewerSnapshot(controller: ReturnType<typeof viewerLiveSession>) {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

function leadingEmoji(text: string) {
  const first = [...text.trim()][0];
  return first && /\p{Extended_Pictographic}/u.test(first) ? first : null;
}

function useLiveChat(streamId: string, enabled: boolean, blocked: string[], onGift: (gift: GiftNotice, animate: boolean) => void) {
  const [messages, setMessages] = useState<LiveStreamChatMessage[]>([]);
  const [connectionMessage, setConnectionMessage] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [text, setText] = useState("");
  const longPress = useRef<number | undefined>(undefined);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [profile, setProfile] = useState<ActionTarget | null>(null);
  const blockedKey = blocked.join("|");
  const seenGiftIds = useRef(new Set<string>());
  useEffect(() => { seenGiftIds.current.clear(); }, [streamId]);

  useEffect(() => {
    if (!enabled || !streamId) return;
    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let retryDelay = 1000;
    let disposed = false;
    const blockedNames = new Set(blocked.map(name => name.toLowerCase()));
    const receiveMessage = (event: MessageEvent<string>) => {
      try {
        const item = JSON.parse(event.data) as LiveStreamChatMessage;
        if (!item.id || !item.username || !item.text) return;
        setConnectionMessage("");
        if (blockedNames.has(item.username.toLowerCase())) return;
        setMessages(current => current.some(existing => existing.id === item.id)
          ? current : [...current, item].slice(-120));
      } catch { /* Ignore malformed events. */ }
    };
    const receiveGift = (event: MessageEvent<string>, animate: boolean) => {
      try {
        const gift = JSON.parse(event.data) as GiftNotice;
        if (!gift.id || !gift.senderUsername || !gift.giftId || seenGiftIds.current.has(gift.id)
          || blockedNames.has(gift.senderUsername.toLowerCase())) return;
        seenGiftIds.current.add(gift.id);
        const age = gift.createdAt ? Date.now() - new Date(gift.createdAt).getTime() : Number.POSITIVE_INFINITY;
        const recentHistoryEvent = !animate && age >= -5000 && age <= 10_000;
        onGift({ ...gift, quantity: gift.quantity || 1 }, animate || recentHistoryEvent);
      } catch { /* Ignore malformed events. */ }
    };
    const connect = () => {
      if (disposed) return;
      const current = new EventSource(liveEndpoint(streamId, "chat/events"), { withCredentials: true });
      source = current;
      current.addEventListener("message", receiveMessage as EventListener);
      current.addEventListener("gift", ((event: MessageEvent<string>) => receiveGift(event, true)) as EventListener);
      current.addEventListener("gift-history-item", ((event: MessageEvent<string>) => receiveGift(event, false)) as EventListener);
      current.onopen = () => { retryDelay = 1000; setConnectionMessage(""); };
      current.onerror = () => {
        if (disposed) return;
        setConnectionMessage("Live chat is reconnecting…");
        if (current.readyState === EventSource.CLOSED) {
          current.close();
          retryTimer = window.setTimeout(connect, retryDelay);
          retryDelay = Math.min(15_000, retryDelay * 2);
        }
      };
    };
    connect();
    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      source?.close();
    };
  // blockedKey is a value key so refetching the same block list does not reset SSE.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, streamId, blockedKey, onGift]);

  useEffect(() => {
    const excluded = new Set(blocked.map(name => name.toLowerCase()));
    setMessages(current => current.filter(message => !excluded.has(message.username.toLowerCase())));
  }, [blockedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const log = logRef.current;
    if (log && pinned.current) log.scrollTop = log.scrollHeight;
  }, [messages]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim().slice(0, 280);
    if (!body || !enabled) return;
    setConnectionMessage("");
    try {
      await sendLiveStreamChatMessage(streamId, { text: body }, { credentials: "include" });
      setText("");
    } catch {
      setConnectionMessage("Your message could not be sent. Check your connection.");
    }
  };

  return {
    messages, text, setText, connectionMessage, logRef, pinned, longPress,
    send, profile, setProfile, report, setReport,
  };
}

function LocalPreview({ stream, videoRef, onBlocked }: {
  stream: MediaStream;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onBlocked: () => void;
}) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    video.muted = true;
    (video as HTMLVideoElement).playsInline = true;
    let frameTimer: number | undefined;
    const checkFrame = () => {
      if (video.videoWidth === 0 || video.videoHeight === 0) onBlocked();
    };
    video.addEventListener("loadeddata", checkFrame);
    void video.play().then(() => {
      frameTimer = window.setTimeout(checkFrame, 2500);
    }).catch(onBlocked);
    return () => {
      video.removeEventListener("loadeddata", checkFrame);
      if (frameTimer) window.clearTimeout(frameTimer);
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [stream, onBlocked, videoRef]);
  return <video ref={videoRef} className="st-live-video" autoPlay muted playsInline />;
}

function RemoteVideo({ track }: { track: RemoteTrack }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const video = track.attach();
    video.className = "st-live-video";
    video.autoplay = true;
    (video as HTMLVideoElement).playsInline = true;
    video.muted = true;
    element.replaceChildren(video);
    return () => { track.detach(video); video.remove(); };
  }, [track]);
  return <div className="st-live-remote-video" ref={ref} />;
}

function RemoteAudio({ track }: { track: RemoteTrack }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const audio = track.attach();
    audio.autoplay = true;
    element.replaceChildren(audio);
    return () => { track.detach(audio); audio.remove(); };
  }, [track]);
  return <div className="st-live-remote-audio" ref={ref} />;
}

function GifterAvatar({ username, name, coins }: { username: string; name: string; coins: number }) {
  const person = useGetSocialPerson(username, {
    query: { queryKey: getGetSocialPersonQueryKey(username), enabled: Boolean(username) },
  });
  const photo = person.data?.photoUrl;
  return <span className="st-live-gifter-avatar" title={`${name} · ${coins} coins`}>
    {photo ? <img src={photo} alt="" /> : [...name][0]?.toUpperCase() ?? "?"}
  </span>;
}

function liveGiftRecipients(
  room: HostLiveSnapshot["room"],
  hostUsername: string,
  hostDisplayName: string,
  blocked: ReadonlySet<string>,
) {
  if (!room || !hostUsername || blocked.has(hostUsername.toLowerCase())) return [];
  return [{ username: hostUsername, displayName: hostDisplayName || hostUsername, isHost: true }];
}

function LiveSurface({ streamId, hostMode, hostState, viewerState, onEnd, onLeave, ownUsername }: {
  streamId: string;
  hostMode: boolean;
  hostState?: HostLiveSnapshot;
  viewerState?: ViewerLiveSnapshot;
  onEnd?: () => void;
  onLeave?: () => void;
  ownUsername: string;
}) {
  const queryClient = useQueryClient();
  const blocks = useGetSocialBlocks({ query: { queryKey: getGetSocialBlocksQueryKey(), refetchInterval: 10_000 } });
  const blocked = useMemo(() => blocks.data?.people.map(person => person.username) ?? [], [blocks.data?.people]);
  const blockedLower = useMemo(() => new Set(blocked.map(name => name.toLowerCase())), [blocked]);
  const setRelationship = useSetSocialRelationship();
  const session = hostMode ? hostState?.session : viewerState?.session;
  const hostUsername = session?.username ?? "";
  const displayName = session?.displayName ?? "Live creator";
  const hostPerson = useGetSocialPerson(hostUsername, {
    query: { queryKey: getGetSocialPersonQueryKey(hostUsername), enabled: Boolean(hostUsername) && !hostMode },
  });
  const ownProfile = useGetSocialMe({
    query: { queryKey: getGetSocialMeQueryKey(), enabled: Boolean(ownUsername) },
  });
  const hostPhoto = hostMode ? ownProfile.data?.profile.photoUrl : hostPerson.data?.photoUrl;
  const hostNameColor = hostMode ? ownProfile.data?.profile.displayNameColor : hostPerson.data?.displayNameColor;
  const hostNameTier = hostMode ? ownProfile.data?.profile.displayNameTierIndex : hostPerson.data?.displayNameTierIndex;
  const avatar = leadingEmoji(displayName);
  const viewerController = viewerLiveSession(streamId);
  const chatReady = hostMode ? Boolean(hostState?.chatReady) : viewerState?.phase === "live";
  const [giftOpen, setGiftOpen] = useState(false);
  const [liveGifters, setLiveGifters] = useState<Map<string, { username: string; name: string; coins: number }>>(() => new Map());
  const [giftQueue, setGiftQueue] = useState<GiftNotice[]>([]);
  const activeGift = giftQueue[0] ?? null;
  const [error, setError] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const [profileAction, setProfileAction] = useState<ActionTarget | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const shareTimer = useRef<number | undefined>(undefined);
  const status = hostMode
    ? hostState?.phase === "live" ? "connected" : hostState?.phase === "livekit-error" ? "reconnecting" : "connecting"
    : viewerState?.phase === "live" ? "connected" : viewerState?.phase === "error" ? "reconnecting" : "connecting";
  const videoTrack = viewerState?.videoTrack ?? null;
  const audioTrack = viewerState?.audioTrack ?? null;
  const localStream = hostState?.localStream ?? null;
  const viewerCount = hostMode ? hostState?.viewerCount ?? 0 : viewerState?.viewerCount ?? 0;
  const muted = hostMode ? !hostState?.microphoneEnabled : false;
  const audioEnabled = viewerState?.audioEnabled ?? false;
  useEffect(() => { setLiveGifters(new Map()); setGiftQueue([]); }, [streamId]);
  const chat = useLiveChat(streamId, chatReady, blocked, useCallback((gift: GiftNotice, animate: boolean) => {
    setLiveGifters(current => {
      const usernameKey = gift.senderUsername.toLowerCase();
      const next = new Map(current);
      const existing = next.get(usernameKey);
      next.set(usernameKey, {
        username: gift.senderUsername,
        name: gift.senderName,
        coins: (existing?.coins ?? 0) + gift.cost,
      });
      return next;
    });
    if (animate) setGiftQueue(current => appendUniqueGiftEvents(current, [gift]));
  }, []));
  const gifterTotals = useMemo(() => {
    return [...liveGifters.values()]
      .filter(item => !blockedLower.has(item.username.toLowerCase()))
      .sort((a, b) => b.coins - a.coins)
      .slice(0, 3);
  }, [blockedLower, liveGifters]);
  const following = hostPerson.data?.favorite ?? false;
  const myName = ownProfile.data?.profile.username ?? ownUsername;
  const myDisplayName = ownProfile.data?.profile.displayName || myName;
  const giftRoom = hostMode ? hostState?.room ?? null : viewerState?.room ?? null;
  const giftRecipients = liveGiftRecipients(giftRoom, hostUsername, displayName, blockedLower);

  const markCameraBlocked = useCallback(() => setCameraBlocked(true), []);
  const retryCameraPlayback = useCallback(async () => {
    try {
      if (localVideoRef.current?.srcObject) {
        await localVideoRef.current.play();
        await new Promise(resolve => window.setTimeout(resolve, 120));
        if (localVideoRef.current.videoWidth > 0) {
          setCameraBlocked(false);
          return;
        }
      }
    } catch {
      setCameraBlocked(true);
    }
    await hostLiveSession.retryCamera(ownUsername);
  }, [ownUsername]);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ streamId?: string }>).detail;
      if (detail?.streamId === streamId) setGiftOpen(true);
    };
    window.addEventListener("streamtalk:open-live-gifts", open);
    return () => window.removeEventListener("streamtalk:open-live-gifts", open);
  }, [streamId]);

  const profileFor = (username: string, name: string, color?: string, tier?: number) => {
    if (username && !blockedLower.has(username.toLowerCase())) setProfileAction({ username, displayName: name, displayNameColor: color, displayNameTierIndex: tier });
  };
  const closeProfile = () => setProfileAction(null);
  const openStreamReport = () => hostUsername && setReportTarget({ targetType: "stream", targetUsername: hostUsername, streamId });
  const blockSelectedUser = () => {
    if (!profileAction) return;
    const target = profileAction;
    setRelationship.mutate({ username: target.username, data: { kind: "block", active: true } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetSocialBlocksQueryKey() });
        setProfileAction(null);
        if (!hostMode && target.username.toLowerCase() === hostUsername.toLowerCase()) onLeave?.();
      },
      onError: () => setError("That account could not be blocked right now. Try again."),
    });
  };
  const follow = () => {
    if (!hostUsername || setRelationship.isPending) return;
    setRelationship.mutate({ username: hostUsername, data: { kind: "favorite", active: !following } }, {
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: getGetSocialPersonQueryKey(hostUsername) }),
      onError: () => setError("Could not update your follow right now. Try again."),
    });
  };
  const finishGift = (giftId: string) => setGiftQueue(current => finishGiftQueueItem(current, giftId));
  const share = async () => {
    const path = base.endsWith("/") ? base : `${base}/`;
    const url = new URL(`${path}live/${encodeURIComponent(streamId)}`, window.location.origin).toString();
    try {
      if (navigator.share) await navigator.share({ title: `${displayName} is live on Deux Wild`, text: "Join my live stream", url });
      else {
        await navigator.clipboard.writeText(url);
        setShareNotice("Stream link copied");
        if (shareTimer.current) window.clearTimeout(shareTimer.current);
        shareTimer.current = window.setTimeout(() => setShareNotice(""), 2400);
      }
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError")) setError("Could not share the stream link.");
    }
  };
  const enableStreamAudio = () => void viewerController.enableAudio();

  return <main className={`st-live-room${hostMode ? " is-host" : " is-viewer"}${hostMode && hostState?.cameraFacing === "user" ? " is-front-camera" : ""}`}
    data-testid="live-room">
    <div className="st-live-player">
      {hostMode && localStream
        ? <LocalPreview stream={localStream} videoRef={localVideoRef} onBlocked={markCameraBlocked} />
        : !hostMode && videoTrack
          ? <RemoteVideo track={videoTrack} />
          : !hostMode && <div className="st-live-player-empty">
            <span className="st-live-avatar">{avatar ?? (hostPhoto ? <img src={hostPhoto} alt="" /> : displayName[0]?.toUpperCase() ?? "S")}</span>
            <strong><ShinyName displayNameColor={hostNameColor} displayNameTierIndex={hostNameTier}>{displayName}</ShinyName></strong><span>Waiting for the host’s camera…</span>
          </div>}
      {hostMode && (!localStream || cameraBlocked) && (
        <div className="st-live-camera-recovery" data-testid="live-camera-recovery">
          <strong>{cameraBlocked || hostState?.phase === "camera-error" ? "Camera preview is unavailable" : "Starting your camera…"}</strong>
          <span>{hostState?.error || (cameraBlocked
            ? "Tap below to retry. If this is an in-app browser, open the link in Chrome or Brave."
            : "Allow camera access to show your live video. If this is an in-app browser, open the link in Chrome or Brave.")}</span>
          <button type="button" data-testid="live-start-camera" onClick={() => {
            setCameraBlocked(false);
            void retryCameraPlayback();
          }}>Tap to start camera</button>
        </div>
      )}
      <div className="st-live-topbar">
        <div className="st-live-creator">
          <button type="button" className="st-live-creator-profile" disabled={hostMode || !hostUsername}
            onClick={() => profileFor(hostUsername, displayName, hostNameColor, hostNameTier)} data-testid="live-creator-profile">
            <span className="st-live-creator-avatar">{avatar ?? (hostPhoto ? <img src={hostPhoto} alt="" /> : displayName[0]?.toUpperCase() ?? "S")}</span>
            <span className="st-live-creator-copy"><strong><ShinyName displayNameColor={hostNameColor} displayNameTierIndex={hostNameTier}>{displayName}</ShinyName></strong>
              <small><i className={status === "connected" ? "is-live" : ""} />{status === "connected" ? "LIVE NOW" : status === "reconnecting" ? "Reconnecting" : "Connecting"}</small>
            </span>
          </button>
          {!hostMode && <button type="button" className={`st-live-follow${following ? " is-following" : ""}`}
            onClick={follow} disabled={!hostUsername || setRelationship.isPending}>{following ? "Following" : "Follow"}</button>}
        </div>
        <div className="st-live-top-actions">
          <div className="st-live-viewers" data-testid="live-viewer-count"><Eye size={15} /><span>{viewerCount.toLocaleString()}</span></div>
          <div className="st-live-gifters" aria-label="Top gifters">
            {gifterTotals.length ? gifterTotals.map(item => <GifterAvatar key={item.username} {...item} />) : <small>Top gifters</small>}
          </div>
          {hostMode
            ? <button type="button" className="st-live-close-button st-live-end" data-testid="live-end-stream"
              onClick={() => { void hostLiveSession.end().then(() => onEnd?.()); }}><X size={18} /><span>End</span></button>
            : <button type="button" className="st-live-close-button" data-testid="live-leave" onClick={() => onLeave?.()} aria-label="Leave live stream"><X size={19} /></button>}
        </div>
      </div>
      {!hostMode && audioTrack && !audioEnabled && <button type="button" className="st-live-audio-enable"
        onClick={enableStreamAudio} data-testid="live-enable-audio">Tap to hear stream</button>}
      {!hostMode && <button type="button" className="st-live-report-stream" onClick={openStreamReport}
        aria-label="Report stream" data-testid="live-report-stream"><Flag size={16} /></button>}
      {(error || hostState?.phase === "livekit-error" || viewerState?.phase === "error") && (
        <div className="st-live-error" role="status" data-testid="live-error">
          <span>{error || hostState?.error || viewerState?.error}</span>
          {hostMode && hostState?.phase === "livekit-error" && <button type="button"
            onClick={() => void hostLiveSession.retryConnection(ownUsername)}>Retry connection</button>}
          {!hostMode && viewerState?.phase === "error" && <button type="button" onClick={() => void viewerController.retry()}>Try again</button>}
        </div>
      )}
      {shareNotice && <div className="st-live-share-status" role="status">{shareNotice}</div>}
      <div className="st-live-chat-overlay">
        {(hostState?.joinNotice || viewerState?.joinNotice) && <div className="st-live-join-banner" role="status">
          <strong>{hostState?.joinNotice || viewerState?.joinNotice}</strong> joined
        </div>}
        <section className="st-live-chat" aria-label="Livestream chat">
          <h2>Live chat</h2>
          <div className="st-live-chat-log" role="log" aria-live="polite" ref={chat.logRef}
            onScroll={() => {
              const log = chat.logRef.current;
              if (log) chat.pinned.current = log.scrollHeight - log.scrollTop - log.clientHeight < 28;
            }}>
            {chat.messages.map(message => (
              <p className="st-live-chat-line" key={message.id}
                onContextMenu={event => {
                  if (message.username === myName) return;
                  event.preventDefault();
                  chat.setReport({ targetType: "message", targetUsername: message.username, streamId, messageId: message.id, messageText: message.text });
                }}
                onTouchStart={() => {
                  if (message.username === myName) return;
                  if (chat.longPress.current) window.clearTimeout(chat.longPress.current);
                  chat.longPress.current = window.setTimeout(() => chat.setReport({
                    targetType: "message", targetUsername: message.username, streamId, messageId: message.id, messageText: message.text,
                  }), 600);
                }}
                onTouchMove={() => { if (chat.longPress.current) window.clearTimeout(chat.longPress.current); chat.longPress.current = undefined; }}
                onTouchEnd={() => { if (chat.longPress.current) window.clearTimeout(chat.longPress.current); chat.longPress.current = undefined; }}
                onTouchCancel={() => { if (chat.longPress.current) window.clearTimeout(chat.longPress.current); chat.longPress.current = undefined; }}>
                <span className="st-live-chat-author">
                  {message.badgeImage && <img className="st-live-chat-badge" src={message.badgeImage} alt={message.badgeName ? `${message.badgeName} badge` : "User badge"} />}
                  {message.username === myName
                    ? <strong><ShinyName displayNameColor={message.displayNameColor} displayNameTierIndex={message.displayNameTierIndex}>{message.displayName}</ShinyName></strong>
                    : <button type="button" className="st-live-chat-name"
                      onClick={() => profileFor(message.username, message.displayName, message.displayNameColor, message.displayNameTierIndex)}><ShinyName displayNameColor={message.displayNameColor} displayNameTierIndex={message.displayNameTierIndex}>{message.displayName}</ShinyName></button>}
                </span>
                <span className="st-live-chat-text">{message.text}</span>
              </p>
            ))}
          </div>
          {chat.connectionMessage && <p className="st-live-chat-connection" role="status">{chat.connectionMessage}</p>}
          <form className="st-live-chat-form" onSubmit={chat.send}>
            <label className="st-live-sr" htmlFor="st-live-chat-input">Write a chat message</label>
            <input id="st-live-chat-input" value={chat.text} onChange={event => chat.setText(event.target.value)}
              maxLength={280} placeholder="Say something…" disabled={!chatReady} />
            <button type="submit" className="bm-btn bm-btn-primary" disabled={!chatReady || !chat.text.trim()} aria-label="Send message">Send</button>
          </form>
        </section>
      </div>
      <div className="st-live-bottom-controls">
        <GiftControl label="Open live gifts" onClick={() => setGiftOpen(true)} />
        {hostMode && <div className="st-live-host-controls">
            <button type="button" onClick={() => void hostLiveSession.flipCamera()} aria-label="Flip camera"><FlipHorizontal size={18} /><span>Flip</span></button>
            <button type="button" className={muted ? "is-mic-off" : "is-mic-on"} onClick={() => void hostLiveSession.toggleMicrophone()}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"} aria-pressed={!muted}>{muted ? <MicOff size={18} /> : <Mic size={18} />}<span>{muted ? "Mic off" : "Mic on"}</span></button>
            <button type="button" onClick={() => void share()} aria-label="Share stream link"><Share2 size={18} /><span>Share</span></button>
          </div>}
      </div>
    </div>
    {audioTrack && <RemoteAudio track={audioTrack} />}
    {giftOpen && <GiftBag recipients={giftRecipients} streamId={streamId} onClose={() => setGiftOpen(false)} />}
    {activeGift && <GiftComboPlayer
      key={activeGift.id}
      gift={activeGift}
      waitingCount={Math.max(0, giftQueue.length - 1)}
      onFinish={() => finishGift(activeGift.id)}
    />}
    {profileAction && <div className="st-live-action-scrim" onClick={() => setProfileAction(null)}>
      <section className="st-live-action-sheet" role="dialog" aria-modal="true" aria-label={`Actions for ${profileAction.displayName}`}
        onClick={event => event.stopPropagation()}>
        <button type="button" className="st-live-action-close" aria-label="Close" onClick={() => setProfileAction(null)}><X size={18} /></button>
        <span className="st-live-action-avatar">{leadingEmoji(profileAction.displayName) ?? profileAction.displayName[0]?.toUpperCase() ?? "S"}</span>
         <h2><ShinyName displayNameColor={profileAction.displayNameColor} displayNameTierIndex={profileAction.displayNameTierIndex}>{profileAction.displayName}</ShinyName></h2>
        <button type="button" onClick={() => { chat.setReport({ targetType: "user", targetUsername: profileAction.username, streamId }); setProfileAction(null); }}>
          <Flag size={16} /> Report user
        </button>
        {!hostMode && <button type="button" onClick={() => { openStreamReport(); setProfileAction(null); }}><Flag size={16} /> Report stream</button>}
        <button type="button" disabled={setRelationship.isPending} onClick={blockSelectedUser}><Ban size={16} /> Block</button>
      </section>
    </div>}
    {chat.report && <SafetyReportDialog targetType={chat.report.targetType} targetUsername={chat.report.targetUsername}
      streamId={chat.report.streamId} messageText={chat.report.messageText} messageId={chat.report.messageId} onClose={() => chat.setReport(null)} />}
    {reportTarget && <SafetyReportDialog targetType={reportTarget.targetType} targetUsername={reportTarget.targetUsername}
      streamId={reportTarget.streamId} messageText={reportTarget.messageText} messageId={reportTarget.messageId} onClose={() => setReportTarget(null)} />}
  </main>;
}

function HostStatusScreen({ snapshot, username, recoveryId, checking, onStart, onResume, onFresh, onBack }: {
  snapshot: HostLiveSnapshot; username: string; recoveryId: string | null; checking: boolean;
  onStart: () => void; onResume: () => void; onFresh: () => void; onBack: () => void;
}) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const ignoreBlocked = useCallback(() => undefined, []);
  return <main className="st-live-room is-host is-front-camera st-live-recovery-screen" data-testid="live-recovery-screen">
    {snapshot.localStream && <LocalPreview stream={snapshot.localStream} videoRef={localVideoRef} onBlocked={ignoreBlocked} />}
    <section className="st-live-camera-recovery st-live-recovery-card">
      <strong>{snapshot.phase === "camera-error" ? "Camera unavailable"
        : snapshot.phase === "conflict" ? "Your stream may still be active"
          : checking ? "Checking your live session…" : snapshot.localStream ? "Camera is ready"
            : recoveryId ? "Resume your live stream" : "Ready to go live?"}</strong>
      <span>{snapshot.error || (recoveryId
        ? "Your previous stream is still listed. Start the camera to reconnect."
        : "Tap once to start your camera and go live. If this is an in-app browser, use Chrome or Brave.")}</span>
      {snapshot.phase === "conflict" ? <div className="st-live-recovery-actions">
        {snapshot.conflictStreamId && <button type="button" onClick={onResume}>Rejoin stream</button>}
        <button type="button" onClick={onFresh}>End it &amp; start fresh</button>
      </div> : snapshot.phase === "server-error" && recoveryId ? <div className="st-live-recovery-actions">
        <button type="button" onClick={onResume}>Try reconnecting</button>
        <button type="button" onClick={onFresh}>End old stream &amp; go live</button>
      </div> : <button type="button" disabled={checking} onClick={recoveryId ? onResume : onStart}
        data-testid="live-start-camera">{recoveryId ? "Tap to start camera" : "Go live"}</button>}
      <button type="button" className="st-live-recovery-back" onClick={onBack}>Back to Deux Wild</button>
      {username && <span className="st-live-sr">Signed in as @{username}</span>}
    </section>
  </main>;
}

export function StartLiveStreamPage() {
  const [snapshot, setSnapshot] = useState(hostLiveSession.getSnapshot());
  const me = useGetSocialMe();
  const [, navigate] = useLocation();
  const username = me.data?.profile?.username ?? "";
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const unsubscribe = hostLiveSession.subscribe(() => setSnapshot(hostLiveSession.getSnapshot()));
    return () => { unsubscribe(); };
  }, []);
  useEffect(() => {
    if (snapshot.phase !== "idle" || !username) return;
    let active = true;
    setChecking(true);
    void getLiveStreams({ credentials: "include" }).then(result => {
      if (!active) return;
      const current = result.streams.find(stream => stream.username.toLowerCase() === username.toLowerCase());
      setRecoveryId(current?.streamId ?? null);
    }).catch(() => { if (active) setRecoveryId(null); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [snapshot.phase, username]);
  const back = () => {
    void hostLiveSession.end();
    navigate("/home");
  };
  const start = () => void hostLiveSession.start(username);
  const resume = () => {
    const streamId = snapshot.conflictStreamId ?? recoveryId;
    if (streamId) void hostLiveSession.resume(streamId);
  };
  const fresh = () => void hostLiveSession.startFresh(username);
  if (snapshot.session) {
    return <LiveSurface streamId={snapshot.session.streamId} hostMode hostState={snapshot}
      ownUsername={username} onEnd={() => navigate("/home")} />;
  }
  return <HostStatusScreen snapshot={snapshot} username={username} recoveryId={recoveryId}
    checking={checking} onStart={start} onResume={resume} onFresh={fresh} onBack={back} />;
}

export function WatchLiveStreamPage({ streamId }: { streamId: string }) {
  const controller = viewerLiveSession(streamId);
  const snapshot = useViewerSnapshot(controller);
  const me = useGetSocialMe();
  const [, navigate] = useLocation();
  useEffect(() => { void controller.connect(); }, [controller]);
  useEffect(() => {
    const leave = () => leaveViewerLiveSession(streamId);
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [streamId]);
  if (snapshot.phase === "error" && !snapshot.session) {
    return <main className="st-live-room is-viewer st-live-recovery-screen">
      <section className="st-live-camera-recovery st-live-recovery-card">
        <strong>Live stream unavailable</strong><span>{snapshot.error}</span>
        <button type="button" onClick={() => void controller.retry()}>Try again</button>
        <button type="button" className="st-live-recovery-back" onClick={() => navigate("/home")}>Back to Deux Wild</button>
      </section>
    </main>;
  }
  return <LiveSurface streamId={streamId} hostMode={false} viewerState={snapshot}
    ownUsername={me.data?.profile?.username ?? ""}
    onLeave={() => { leaveViewerLiveSession(streamId); navigate("/home"); }} />;
}

export function LiveStreamsDirectory() {
  const [streams, setStreams] = useState<LiveStreamEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const result = await getLiveStreams({ credentials: "include" });
      setStreams(result.streams);
      setError("");
    } catch {
      setError("Live streams are temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return <main className="st-live-page">
    <header className="st-live-page-head"><Link href="/home" className="st-live-back"><ArrowLeft size={18} /> Directory</Link>
      <h1>Live creators</h1><p>Watch and chat with creators who are live now.</p></header>
    {loading && <p className="st-live-muted">Checking for live streams…</p>}
    {error && <p className="st-live-error" role="alert">{error}</p>}
    {!loading && !error && streams.length === 0 && <section className="st-live-empty"><Radio size={28} /><strong>No creator streams right now</strong><span>When someone goes live, they’ll appear here.</span></section>}
    <div className="st-live-directory-grid">{streams.map(stream => <Link className="st-live-directory-card" href={`/live/${stream.streamId}`} key={stream.streamId}>
      <div className="st-live-directory-thumb"><Video size={30} /><span className="st-live-state is-live"><i /> LIVE</span></div>
      <strong><ShinyName displayNameColor={stream.displayNameColor} displayNameTierIndex={stream.displayNameTierIndex}>{stream.displayName}</ShinyName></strong><span><Users size={15} /> {stream.viewerCount} watching</span><b>Watch live</b>
    </Link>)}</div>
  </main>;
}

export function GoLiveButton({ className, children }: { className: string; children: ReactNode }) {
  const [, navigate] = useLocation();
  const me = useGetSocialMe();
  return <button type="button" className={className} onClick={() => {
    void hostLiveSession.start(me.data?.profile?.username ?? "");
    navigate("/live/start");
  }}>{children}</button>;
}
