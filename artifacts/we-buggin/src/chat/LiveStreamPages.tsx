import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Eye, Flag, FlipHorizontal, Gift, Mic, MicOff, Radio, Send, Share2, Users, Video, X } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Room, RoomEvent, Track, createLocalTracks, type LocalTrack, type RemoteTrack } from "livekit-client";
import {
  endLiveStream, getGetSocialBlocksQueryKey, getGetSocialPersonQueryKey, getLiveStreams, joinLiveStream, rejoinLiveStream,
  getGetSocialMeQueryKey, sendLiveStreamChatMessage, startLiveStream, useGetSocialBlocks,
  useGetSocialMe, useGetSocialPerson, useSetSocialRelationship,
} from "@workspace/api-client-react";
import type { LiveStreamEntry, LiveStreamChatMessage } from "@workspace/api-client-react";
import { GiftBag } from "@/gifts";
import { CosmicEncoreAnimation, MoonfoxAnimation, SpiritAnimation } from "@/gifts/SpiritPup";
import { HeartAnimation } from "@/gifts/HeartAnimation";
import { SafetyReportDialog } from "@/safety/SafetyReportDialog";
import "./live-stream.css";

type LiveChatActionTarget = { username: string; displayName: string };
type LiveChatReportTarget = { targetType: "message" | "stream" | "user"; targetUsername: string; messageId?: string; messageText?: string; streamId?: string };
type LiveStreamGiftNotice = {
  id: string;
  streamId: string;
  senderUsername: string;
  senderName: string;
  recipientUsername: string;
  recipientName: string;
  giftId: "heart" | "spirit-pup" | "moonfox" | "cosmic-encore";
  giftName: string;
  cost: number;
  createdAt: string;
};
type HostStartSession = Awaited<ReturnType<typeof startLiveStream>>;
let pendingLiveHostStart: { session: HostStartSession; tracks: LocalTrack[] } | null = null;
const NO_HOST_TRACKS: LocalTrack[] = [];

function cameraAccessHelp(failure?: unknown): string {
  const name = failure instanceof Error ? failure.name : "";
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return "This in-app browser does not provide camera access. Open this link in Chrome or Brave, then allow camera and microphone access.";
  }
  if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(name)) {
    return "Camera or microphone permission was denied. Allow access in browser settings. If this is an in-app browser, open the link in Chrome or Brave.";
  }
  if (["NotFoundError", "DevicesNotFoundError"].includes(name)) {
    return "No camera was found. Connect or enable a camera, then try again.";
  }
  if (["NotReadableError", "TrackStartError"].includes(name)) {
    return "The camera is busy or unavailable. Close other apps using it, then try again in Chrome or Brave.";
  }
  return "Camera startup failed. Check camera permission and try again. If this is an in-app browser, open the link in Chrome or Brave.";
}

export function GoLiveButton({ className, children }: { className: string; children: ReactNode }) {
  const [, navigate] = useLocation();
  const me = useGetSocialMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [replacePrompt, setReplacePrompt] = useState(false);
  const [conflictStreamId, setConflictStreamId] = useState<string | null>(null);

  const start = async (replaceExisting = false) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setReplacePrompt(false);
    let tracks: LocalTrack[] = [];
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        const unavailable = new Error("Camera API unavailable");
        unavailable.name = "CameraUnavailableError";
        throw unavailable;
      }
      // Request permission directly from the tap on Go Live.
      tracks = await createLocalTracks({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { facingMode: "user", resolution: { width: 720, height: 1280 }, frameRate: 30 },
      });
      if (!tracks.some(track => track.kind === Track.Kind.Video)) {
        const unavailable = new Error("No camera track was created");
        unavailable.name = "CameraUnavailableError";
        throw unavailable;
      }
      const session = await startLiveStream({ replaceExisting }, { credentials: "include" });
      pendingLiveHostStart = { session, tracks };
      tracks = [];
      navigate("/live/start");
    } catch (failure) {
      for (const track of tracks) track.stop();
      const name = failure instanceof Error ? failure.name : "";
      const status = typeof failure === "object" && failure !== null && "status" in failure
        ? Number((failure as { status?: unknown }).status) : 0;
      if (status === 409 && !replaceExisting) {
        let activeStreamId: string | null = null;
        try {
          const streams = await getLiveStreams({ credentials: "include" });
          const username = me.data?.profile?.username?.toLowerCase();
          activeStreamId = streams.streams.find(stream => stream.username.toLowerCase() === username)?.streamId ?? null;
        } catch {
          // The owner can still end the previous session without a stream card.
        }
        setConflictStreamId(activeStreamId);
        setReplacePrompt(true);
      } else {
        setError(!navigator.mediaDevices?.getUserMedia || !window.isSecureContext || ["NotAllowedError", "PermissionDeniedError",
          "SecurityError", "NotFoundError", "DevicesNotFoundError", "NotReadableError", "TrackStartError",
          "CameraUnavailableError", "TypeError"].includes(name)
          ? cameraAccessHelp(failure)
          : status === 401 ? "Please sign in again before going live."
            : status === 403 ? "Finish your profile setup before going live."
              : status === 503 ? "Live video is temporarily unavailable. Please try again soon."
                : "Could not start the live stream. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const rejoin = async () => {
    if (!conflictStreamId || busy) return;
    setBusy(true);
    setError("");
    let tracks: LocalTrack[] = [];
    try {
      tracks = await createLocalTracks({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { facingMode: "user", resolution: { width: 720, height: 1280 }, frameRate: 30 },
      });
      if (!tracks.some(track => track.kind === Track.Kind.Video)) {
        const unavailable = new Error("No camera track was created");
        unavailable.name = "CameraUnavailableError";
        throw unavailable;
      }
      const session = await rejoinLiveStream(conflictStreamId, { credentials: "include" });
      pendingLiveHostStart = { session, tracks };
      tracks = [];
      setReplacePrompt(false);
      navigate("/live/start");
    } catch (failure) {
      for (const track of tracks) track.stop();
      const status = typeof failure === "object" && failure !== null && "status" in failure
        ? Number((failure as { status?: unknown }).status) : 0;
      setError(status === 404
        ? "That stream has already ended. Start a fresh one instead."
        : status === 503
          ? "Live video is temporarily unavailable. Please try again soon."
          : "Could not reconnect to that stream. Please try again.");
      setReplacePrompt(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="st-live-start-control">
      <button type="button" className={className} disabled={busy} onClick={() => void start()}>
        {busy ? "Starting…" : children}
      </button>
      {error && <span className="st-live-start-banner" role="status">
        <span>{error}</span>
        <button type="button" className="st-live-start-retry" data-testid="live-start-retry"
          disabled={busy} onClick={() => void start()}>
          {busy ? "Starting…" : "Try again"}
        </button>
      </span>}
      {replacePrompt && <span className="st-live-start-banner st-live-start-choice" role="alert">
        <strong>A stream may still be active.</strong>
        <span>Rejoin it, or end it and start fresh?</span>
        <span className="st-live-start-choice-actions">
          {conflictStreamId && <button type="button" disabled={busy} onClick={() => void rejoin()}>Rejoin stream</button>}
          <button type="button" disabled={busy} onClick={() => void start(true)}>End it &amp; start here</button>
          <button type="button" disabled={busy} onClick={() => setReplacePrompt(false)}>Cancel</button>
        </span>
      </span>}
    </span>
  );
}

function usernameFromMetadata(metadata?: string): string | undefined {
  if (!metadata) return;
  try {
    const parsed = JSON.parse(metadata) as { username?: unknown };
    return typeof parsed.username === "string" ? parsed.username : undefined;
  } catch { return; }
}

function leadingEmoji(value: string): string | undefined {
  const first = [...value.trim()][0];
  return first && /\p{Extended_Pictographic}/u.test(first) ? first : undefined;
}

function StreamTrack({ track, kind, muted = false, onPlaybackBlocked, onVideoElement }: {
  track?: LocalTrack | RemoteTrack;
  kind: "audio" | "video";
  muted?: boolean;
  onPlaybackBlocked?: (blocked: boolean) => void;
  onVideoElement?: (element: HTMLVideoElement | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const onPlaybackBlockedRef = useRef(onPlaybackBlocked);
  const onVideoElementRef = useRef(onVideoElement);
  onPlaybackBlockedRef.current = onPlaybackBlocked;
  onVideoElementRef.current = onVideoElement;
  useEffect(() => {
    const element = kind === "video" ? videoRef.current : audioRef.current;
    if (!element || !track) return;
    let videoReadinessTimer: number | undefined;
    const checkVideoFrame = (candidate: HTMLVideoElement) => {
      const ready = candidate.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && candidate.videoWidth > 0;
      if (ready) onPlaybackBlockedRef.current?.(false);
      return ready;
    };
    const onVideoReady = (event: Event) => {
      if (event.currentTarget instanceof HTMLVideoElement) checkVideoFrame(event.currentTarget);
    };
    const onVideoError = () => onPlaybackBlockedRef.current?.(true);
    try {
      const attached = track.attach(element);
      attached.autoplay = true;
      if (attached instanceof HTMLVideoElement) {
        attached.muted = muted;
        attached.defaultMuted = muted;
        attached.playsInline = true;
        onVideoElementRef.current?.(attached);
        attached.addEventListener("loadeddata", onVideoReady);
        attached.addEventListener("playing", onVideoReady);
        attached.addEventListener("resize", onVideoReady);
        attached.addEventListener("error", onVideoError);
        videoReadinessTimer = window.setTimeout(() => {
          if (!checkVideoFrame(attached)) onPlaybackBlockedRef.current?.(true);
        }, 3000);
      }
      if (kind === "video") {
        void attached.play()
          .then(() => {
            if (attached instanceof HTMLVideoElement) checkVideoFrame(attached);
          })
          .catch(() => onPlaybackBlockedRef.current?.(true));
      } else {
        void attached.play().catch(() => onPlaybackBlockedRef.current?.(true));
      }
      return () => {
        if (videoReadinessTimer) window.clearTimeout(videoReadinessTimer);
        if (element instanceof HTMLVideoElement) {
          element.removeEventListener("loadeddata", onVideoReady);
          element.removeEventListener("playing", onVideoReady);
          element.removeEventListener("resize", onVideoReady);
          element.removeEventListener("error", onVideoError);
        }
        if (element instanceof HTMLVideoElement) onVideoElementRef.current?.(null);
        track.detach(element);
      };
    } catch {
      onPlaybackBlockedRef.current?.(true);
      return;
    }
  }, [kind, muted, track]);
  if (!track) return null;
  return kind === "video"
    ? <video ref={videoRef} className="st-live-video" style={{ backgroundColor: "#000" }}
      autoPlay playsInline muted={muted} aria-label="Live camera stream" />
    : <audio ref={audioRef} autoPlay />;
}

function LiveChat({ room, streamId, ownUsername, blockedUsernames,
  onProfile, onReportMessage, onGift }: {
  room: Room | null;
  streamId: string;
  ownUsername: string;
  blockedUsernames: string[];
  onProfile: (target: LiveChatActionTarget) => void;
  onReportMessage: (target: LiveChatReportTarget) => void;
  onGift: (gift: LiveStreamGiftNotice, animate: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<LiveStreamChatMessage[]>([]);
  const [error, setError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const pinnedToLatest = useRef(true);
  const longPress = useRef<number | null>(null);

  useEffect(() => {
    if (!room) return;
    const url = `${import.meta.env.BASE_URL}api/account/live-streams/${encodeURIComponent(streamId)}/chat/events`;
    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let retryDelayMs = 1000;
    let disposed = false;
    const receive = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as LiveStreamChatMessage;
        if (!parsed.id || !parsed.username || !parsed.text) return;
        setError("");
        const blocked = new Set(blockedUsernames.map(name => name.toLowerCase()));
        if (blocked.has(parsed.username.toLowerCase())) return;
        setMessages(current => current.some(message => message.id === parsed.id)
          ? current : [...current, parsed].slice(-120));
      } catch {
        // Ignore malformed chat events.
      }
    };
    const receiveGift = (event: MessageEvent<string>, animate: boolean) => {
      try {
        const parsed = JSON.parse(event.data) as LiveStreamGiftNotice;
        if (!parsed.id || !parsed.senderUsername || !parsed.giftId) return;
        const blocked = new Set(blockedUsernames.map(name => name.toLowerCase()));
        if (!blocked.has(parsed.senderUsername.toLowerCase())) onGift(parsed, animate);
      } catch {
        // Ignore malformed gift events.
      }
    };
    const connect = () => {
      if (disposed) return;
      const current = new EventSource(url, { withCredentials: true });
      source = current;
      current.addEventListener("message", receive as EventListener);
      current.addEventListener("gift", (event => receiveGift(event as MessageEvent<string>, true)) as EventListener);
      current.addEventListener("gift-history-item", (event => receiveGift(event as MessageEvent<string>, false)) as EventListener);
      current.onopen = () => {
        retryDelayMs = 1000;
        setError("");
      };
      current.onerror = () => {
        if (disposed) return;
        setError("Live chat is reconnecting…");
        // EventSource automatically retries most network errors, but a 404/401
        // closes it permanently. Retry closed sources so startup races recover.
        if (current.readyState === EventSource.CLOSED) {
          current.close();
          retryTimer = window.setTimeout(connect, retryDelayMs);
          retryDelayMs = Math.min(15_000, retryDelayMs * 2);
        }
      };
    };
    connect();
    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      source?.close();
    };
  }, [blockedUsernames, onGift, room, streamId]);

  useEffect(() => {
    const blocked = new Set(blockedUsernames.map(name => name.toLowerCase()));
    setMessages(current => current.filter(message => !blocked.has(message.username.toLowerCase())));
  }, [blockedUsernames]);

  useEffect(() => {
    const log = logRef.current;
    if (log && pinnedToLatest.current) log.scrollTop = log.scrollHeight;
  }, [messages]);

  const updateScrollPin = () => {
    const log = logRef.current;
    if (!log) return;
    pinnedToLatest.current = log.scrollHeight - log.scrollTop - log.clientHeight < 28;
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim().slice(0, 280);
    if (!body || !room) return;
    setError("");
    try {
      await sendLiveStreamChatMessage(streamId, { text: body }, { credentials: "include" });
      setText("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Message could not be sent. Check your connection.");
    }
  };

  return (
    <section className="st-live-chat" aria-label="Livestream chat">
      <h2>Live chat</h2>
      <div className="st-live-chat-log" role="log" aria-live="polite" ref={logRef} onScroll={updateScrollPin}>
        {messages.length === 0 && <p className="st-live-muted">Say hello while the creator is live.</p>}
        {messages.map(message => (
          <p className="st-live-chat-line" key={message.id}
            onContextMenu={event => {
              if (message.username === ownUsername) return;
              event.preventDefault();
              onReportMessage({ targetType: "message", targetUsername: message.username,
                messageId: message.id, messageText: message.text });
            }}
            onTouchStart={() => {
              if (message.username === ownUsername) return;
              if (longPress.current) window.clearTimeout(longPress.current);
              longPress.current = window.setTimeout(() => onReportMessage({
                targetType: "message", targetUsername: message.username, messageId: message.id, messageText: message.text,
              }), 600);
            }}
            onTouchMove={() => { if (longPress.current) window.clearTimeout(longPress.current); longPress.current = null; }}
            onTouchEnd={() => { if (longPress.current) window.clearTimeout(longPress.current); longPress.current = null; }}
            onTouchCancel={() => { if (longPress.current) window.clearTimeout(longPress.current); longPress.current = null; }}>
            <span className="st-live-chat-author">
              {message.badgeImage && <img className="st-live-chat-badge" src={message.badgeImage}
                alt={message.badgeName ? `${message.badgeName} badge` : "User badge"} />}
              {message.username === ownUsername
                ? <strong style={{ color: message.displayNameColor }} title={`@${message.username}`}>{message.displayName}</strong>
                : <button type="button" className="st-live-chat-name" style={{ color: message.displayNameColor }}
                  onClick={() => onProfile({ username: message.username, displayName: message.displayName })}
                  title={`@${message.username}`} data-testid={`live-chat-profile-${message.id}`}>{message.displayName}</button>}
            </span>
            <span className="st-live-chat-text">{message.text}</span>
          </p>
        ))}
      </div>
      {error && <p className="st-live-chat-connection" role="status" data-testid="live-chat-connection">{error}</p>}
      <form className="st-live-chat-form" onSubmit={send}>
        <label className="st-live-sr" htmlFor="st-live-chat-input">Write a chat message</label>
        <input id="st-live-chat-input" value={text} onChange={event => setText(event.target.value)}
          data-testid="live-chat-input"
          maxLength={280} placeholder="Say something…" disabled={!room} />
        <button type="submit" disabled={!room || !text.trim()} aria-label="Send message" data-testid="live-chat-send"><Send size={17} /></button>
      </form>
    </section>
  );
}

function LiveGifterAvatar({ username, name, credits }: { username: string; name: string; credits: number }) {
  const person = useGetSocialPerson(username, {
    query: { queryKey: getGetSocialPersonQueryKey(username), enabled: !!username },
  });
  const photoUrl = person.data?.photoUrl;
  return (
    <span className="st-live-gifter-avatar" title={`${name} · ${credits} credits`} data-testid={`live-top-gifter-${username}`}>
      {photoUrl ? <img src={photoUrl} alt="" /> : [...name][0]?.toUpperCase() ?? "?"}
    </span>
  );
}

function attachRoomEvents(room: Room, setVideo: (track: LocalTrack | RemoteTrack | null) => void,
  setAudio: (track: LocalTrack | RemoteTrack | null) => void, setStatus: (status: string) => void) {
  const refreshTracks = () => {
    let video: LocalTrack | RemoteTrack | null = null;
    let audio: LocalTrack | RemoteTrack | null = null;
    for (const publication of room.localParticipant.trackPublications.values()) {
      if (!publication.track) continue;
      if (publication.kind === Track.Kind.Video) video = publication.track as LocalTrack;
      if (publication.kind === Track.Kind.Audio) audio = publication.track as LocalTrack;
    }
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (!publication.track) continue;
        if (publication.kind === Track.Kind.Video) video = publication.track as RemoteTrack;
        if (publication.kind === Track.Kind.Audio) audio = publication.track as RemoteTrack;
      }
    }
    setVideo(video);
    setAudio(audio);
  };
  room.on(RoomEvent.TrackSubscribed, refreshTracks);
  room.on(RoomEvent.TrackUnsubscribed, refreshTracks);
  room.on(RoomEvent.ParticipantConnected, refreshTracks);
  room.on(RoomEvent.ParticipantDisconnected, refreshTracks);
  room.on(RoomEvent.Disconnected, () => {
    setStatus("disconnected");
    setVideo(null);
    setAudio(null);
  });
  room.on(RoomEvent.ConnectionStateChanged, state => {
    if (state === "connected") setStatus("connected");
    if (state === "reconnecting") setStatus("reconnecting");
  });
}

function LiveRoomView({ streamId, hostMode, hostSession, hostTracks = NO_HOST_TRACKS, onEnded, onLeave }: {
  streamId: string;
  hostMode: boolean;
  hostSession?: { url: string; token: string; displayName: string; username: string; viewerUsername?: string };
  hostTracks?: LocalTrack[];
  onEnded?: () => void;
  onLeave?: () => void;
}) {
  const queryClient = useQueryClient();
  const blocks = useGetSocialBlocks({ query: { queryKey: getGetSocialBlocksQueryKey(), refetchInterval: 10_000 } });
  const setRelationship = useSetSocialRelationship();
  const roomRef = useRef<Room | null>(null);
  const localTracksRef = useRef<LocalTrack[]>(hostTracks);
  const localVideoElementRef = useRef<HTMLVideoElement | null>(null);
  const leavingRef = useRef(false);
  const sessionEndedRef = useRef(false);
  const endBeaconSentRef = useRef(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const [room, setRoom] = useState<Room | null>(null);
  const [videoTrack, setVideoTrack] = useState<LocalTrack | RemoteTrack | null>(
    () => hostMode ? hostTracks.find(track => track.kind === Track.Kind.Video) ?? null : null,
  );
  const [audioTrack, setAudioTrack] = useState<LocalTrack | RemoteTrack | null>(null);
  const [status, setStatus] = useState("connecting");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [cameraFrameReady, setCameraFrameReady] = useState(false);
  const [cameraPlaybackBlocked, setCameraPlaybackBlocked] = useState(false);
  const [cameraFailureReason, setCameraFailureReason] = useState("");
  const [cameraRetrying, setCameraRetrying] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<"user" | "environment">("user");
  const [viewerCount, setViewerCount] = useState(0);
  const [liveGiftEvents, setLiveGiftEvents] = useState<LiveStreamGiftNotice[]>([]);
  const [activeGift, setActiveGift] = useState<LiveStreamGiftNotice | null>(null);
  const [giftOpen, setGiftOpen] = useState(false);
  const joinNoticeTimer = useRef<number | undefined>(undefined);
  const [visibleJoinNotice, setVisibleJoinNotice] = useState("");
  const [error, setError] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const shareNoticeTimer = useRef<number | undefined>(undefined);
  const [displayName, setDisplayName] = useState(hostSession?.displayName ?? "Live creator");
  const [hostUsername, setHostUsername] = useState(hostSession?.username ?? "");
  const [ownUsername, setOwnUsername] = useState(hostMode ? hostSession?.username ?? "" : "");
  const [profileAction, setProfileAction] = useState<LiveChatActionTarget | null>(null);
  const [reportTarget, setReportTarget] = useState<LiveChatReportTarget | null>(null);
  const blockedUsernames = useMemo(() => blocks.data?.people.map(person => person.username) ?? [], [blocks.data?.people]);
  const hostPerson = useGetSocialPerson(hostUsername, {
    query: { queryKey: getGetSocialPersonQueryKey(hostUsername), enabled: !!hostUsername && !hostMode },
  });
  const ownProfile = useGetSocialMe({
    query: { queryKey: getGetSocialMeQueryKey(), enabled: hostMode },
  });
  const hostAvatarUrl = hostMode ? ownProfile.data?.profile.photoUrl : hostPerson.data?.photoUrl;
  const hostAvatarEmoji = leadingEmoji(displayName);
  const following = hostPerson.data?.favorite ?? false;
  const gifterTotals = useMemo(() => {
    const totals = new Map<string, { username: string; name: string; credits: number }>();
    const blocked = new Set(blockedUsernames.map(name => name.toLowerCase()));
    for (const gift of liveGiftEvents) {
      if (blocked.has(gift.senderUsername.toLowerCase())) continue;
      const current = totals.get(gift.senderUsername) ?? {
        username: gift.senderUsername, name: gift.senderName, credits: 0,
      };
      current.credits += gift.cost;
      totals.set(gift.senderUsername, current);
    }
    return [...totals.values()].sort((a, b) => b.credits - a.credits).slice(0, 3);
  }, [blockedUsernames, liveGiftEvents]);

  useEffect(() => {
    if (!hostMode) return;
    sessionEndedRef.current = false;
    endBeaconSentRef.current = false;
    const sendEndBeacon = () => {
      if (sessionEndedRef.current || endBeaconSentRef.current) return;
      endBeaconSentRef.current = true;
      const url = `${import.meta.env.BASE_URL}api/account/live-streams/${encodeURIComponent(streamId)}/end`;
      try {
        const sent = navigator.sendBeacon(url, new Blob(["{}"], { type: "application/json" }));
        if (!sent) {
          void fetch(url, {
            method: "POST",
            credentials: "include",
            keepalive: true,
            headers: { "Content-Type": "application/json" },
            body: "{}",
          }).catch(() => undefined);
        }
      } catch {
        // The server heartbeat lease remains the fallback if the browser blocks unload requests.
      }
    };
    window.addEventListener("pagehide", sendEndBeacon);
    return () => {
      window.removeEventListener("pagehide", sendEndBeacon);
      sendEndBeacon();
    };
  }, [hostMode, streamId]);

  useEffect(() => {
    const openGiftPanel = (event: Event) => {
      const detail = (event as CustomEvent<{ streamId?: unknown }>).detail;
      if (detail?.streamId === streamId) setGiftOpen(true);
    };
    window.addEventListener("streamtalk:open-live-gifts", openGiftPanel);
    return () => window.removeEventListener("streamtalk:open-live-gifts", openGiftPanel);
  }, [streamId]);

  useEffect(() => {
    if (!hostMode || !room || status !== "connected") return;
    let active = true;
    let inFlight = false;
    const heartbeat = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}api/account/live-streams/${encodeURIComponent(streamId)}/heartbeat`,
          { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: "{}" },
        );
        if (response.status === 404 && active) {
          sessionEndedRef.current = true;
          setStatus("ended");
          setError("This live session ended after the connection was lost.");
          await room.disconnect();
          onEndedRef.current?.();
        }
      } catch {
        // A missed heartbeat is retried; the server ends the stream after the 30-second lease expires.
      } finally {
        inFlight = false;
      }
    };
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [hostMode, room, status, streamId]);

  const receiveLiveGift = useCallback((gift: LiveStreamGiftNotice, animate: boolean) => {
    setLiveGiftEvents(current => current.some(item => item.id === gift.id)
      ? current : [...current, gift].slice(-100));
    if (animate) setActiveGift(gift);
  }, []);
  const finishLiveGift = useCallback((giftId: string) => {
    setActiveGift(current => current?.id === giftId ? null : current);
  }, []);
  const closeLiveGiftPanel = useCallback(() => setGiftOpen(false), []);

  const blockSelectedUser = () => {
    if (!profileAction) return;
    const blockedUsername = profileAction.username;
    setRelationship.mutate({ username: profileAction.username, data: { kind: "block", active: true } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetSocialBlocksQueryKey() });
        setProfileAction(null);
        if (!hostMode && blockedUsername.toLowerCase() === hostUsername.toLowerCase()) {
          leavingRef.current = true;
          const currentRoom = roomRef.current;
          if (currentRoom) void currentRoom.disconnect().finally(() => onLeave?.());
          else onLeave?.();
        }
      },
      onError: () => setError("That account could not be blocked right now. Try again."),
    });
  };
  const openStreamReport = () => {
    if (hostUsername) setReportTarget({ targetType: "stream", targetUsername: hostUsername });
  };

  useEffect(() => {
    let cancelled = false;
    const connect = async () => {
      let session = hostSession;
      if (!hostMode) session = await joinLiveStream(streamId, { credentials: "include" });
      if (!session || cancelled) return;
      setDisplayName(session.displayName);
      setHostUsername(session.username);
      setOwnUsername(hostMode ? session.username : session.viewerUsername ?? "");
      const liveRoom = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = liveRoom;
      attachRoomEvents(liveRoom, setVideoTrack, setAudioTrack, setStatus);
      if (hostMode) {
        const localCamera = hostTracks.find(track => track.kind === Track.Kind.Video);
        if (localCamera) setVideoTrack(localCamera);
      }
      await liveRoom.connect(session.url, session.token);
      if (cancelled) { await liveRoom.disconnect(); return; }
      if (hostMode) {
        for (const track of localTracksRef.current) {
          if (track.mediaStreamTrack.readyState === "ended") continue;
          if (track.kind === Track.Kind.Video) setVideoTrack(track);
          await liveRoom.localParticipant.publishTrack(track);
          if (track.kind === Track.Kind.Audio) setAudioTrack(track);
        }
        // The chat SSE endpoint requires a fresh live lease. Establish it before
        // mounting LiveChat so its first request cannot race the first heartbeat.
        const heartbeatUrl = `${import.meta.env.BASE_URL}api/account/live-streams/${encodeURIComponent(streamId)}/heartbeat`;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            const response = await fetch(heartbeatUrl, {
              method: "POST",
              credentials: "include",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
            if (response.ok || response.status !== 404) break;
          } catch {
            // The regular heartbeat and EventSource retry paths remain available.
          }
          if (attempt < 3) await new Promise(resolve => window.setTimeout(resolve, 250 + attempt * 250));
        }
      }
      if (cancelled) { await liveRoom.disconnect(); return; }
      setRoom(liveRoom);
      setStatus("connected");
      const updateViewerCount = () => setViewerCount(Math.max(0,
        liveRoom.remoteParticipants.size + (hostMode ? 0 : 1)));
      updateViewerCount();
      liveRoom.on(RoomEvent.ParticipantConnected, updateViewerCount);
      liveRoom.on(RoomEvent.ParticipantDisconnected, updateViewerCount);
      liveRoom.on(RoomEvent.ParticipantConnected, participant => {
        if (participant.identity === "host") return;
        const name = participant.name?.trim() || "Someone";
        setVisibleJoinNotice(name);
        if (joinNoticeTimer.current) window.clearTimeout(joinNoticeTimer.current);
        joinNoticeTimer.current = window.setTimeout(() => setVisibleJoinNotice(""), 2800);
      });
      liveRoom.on(RoomEvent.Disconnected, () => {
        if (!hostMode && !cancelled && !leavingRef.current) onEnded?.();
      });
      for (const participant of liveRoom.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          if (publication.track?.kind === Track.Kind.Video) setVideoTrack(publication.track as RemoteTrack);
          if (publication.track?.kind === Track.Kind.Audio) setAudioTrack(publication.track as RemoteTrack);
        }
      }
      for (const publication of liveRoom.localParticipant.trackPublications.values()) {
        if (publication.track?.kind === Track.Kind.Video) setVideoTrack(publication.track as LocalTrack);
        if (publication.track?.kind === Track.Kind.Audio) setAudioTrack(publication.track as LocalTrack);
      }
      if (!hostMode) {
        try { await liveRoom.startAudio(); setAudioEnabled(true); }
        catch { setAudioEnabled(false); }
      } else {
        setAudioEnabled(true);
      }
    };
    void connect().catch(() => {
      if (!cancelled) {
        setStatus("disconnected");
        setError("The livestream connection failed. Try opening it again.");
      }
    });
    return () => {
      cancelled = true;
      if (joinNoticeTimer.current) window.clearTimeout(joinNoticeTimer.current);
      if (shareNoticeTimer.current) window.clearTimeout(shareNoticeTimer.current);
      const current = roomRef.current;
      roomRef.current = null;
      if (current) void current.disconnect();
      for (const track of localTracksRef.current) track.stop();
      localTracksRef.current = [];
    };
  }, [hostMode, hostSession, hostTracks, onEnded, streamId]);

  const enableAudio = async () => {
    try {
      await roomRef.current?.startAudio();
      setAudioEnabled(true);
    } catch {
      setError("Tap the audio control again to enable stream sound.");
    }
  };

  const end = async () => {
    setStatus("ending");
    try {
      await endLiveStream(streamId, { credentials: "include" });
      sessionEndedRef.current = true;
      await roomRef.current?.disconnect();
      for (const track of localTracksRef.current) track.stop();
      localTracksRef.current = [];
      setRoom(null);
      setStatus("ended");
      onEnded?.();
    } catch {
      setError("The stream could not be ended. Check your connection and try again.");
      setStatus("connected");
    }
  };

  const toggleFollow = () => {
    if (!hostUsername || setRelationship.isPending) return;
    const next = !Boolean(hostPerson.data?.favorite);
    setRelationship.mutate({ username: hostUsername, data: { kind: "favorite", active: next } }, {
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: getGetSocialPersonQueryKey(hostUsername) }),
      onError: () => setError("Could not update your follow right now. Try again."),
    });
  };

  const flipCamera = async () => {
    const track = localTracksRef.current.find(item => item.kind === Track.Kind.Video) as
      (LocalTrack & { restartTrack?: (options: { facingMode: string }) => Promise<void> }) | undefined;
    if (!track?.restartTrack) return;
    const next = cameraFacing === "user" ? "environment" : "user";
    try {
      await track.restartTrack({ facingMode: next });
      setCameraFacing(next);
    } catch {
      setError("The camera could not be switched.");
    }
  };

  const startCameraFromTap = async () => {
    setCameraRetrying(true);
    setCameraFrameReady(false);
    setCameraPlaybackBlocked(false);
    setCameraFailureReason("");
    setError("");
    let acquiredTracks: LocalTrack[] = [];
    try {
      const currentVideo = localVideoElementRef.current;
      if (currentVideo && videoTrack && currentVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && currentVideo.videoWidth > 0) {
        try {
          await currentVideo.play();
          setCameraFrameReady(true);
          setCameraPlaybackBlocked(false);
          setCameraFailureReason("");
          return;
        } catch {
          // If playback is still blocked, reacquire the camera from this tap.
        }
      }
      acquiredTracks = await createLocalTracks({
        audio: false,
        video: { facingMode: cameraFacing, resolution: { width: 720, height: 1280 }, frameRate: 30 },
      });
      const nextVideoTrack = acquiredTracks.find(track => track.kind === Track.Kind.Video);
      if (!nextVideoTrack) throw new Error("No camera track was created.");
      const previousVideo = localTracksRef.current.find(track => track.kind === Track.Kind.Video);
      if (previousVideo) {
        try { await roomRef.current?.localParticipant.unpublishTrack(previousVideo); } catch { /* It may not be published yet. */ }
        previousVideo.stop();
      }
      localTracksRef.current = [...localTracksRef.current.filter(track => track !== previousVideo), nextVideoTrack];
      acquiredTracks = [];
      setVideoTrack(nextVideoTrack);
      const currentRoom = roomRef.current;
      if (currentRoom?.state === "connected") {
        await currentRoom.localParticipant.publishTrack(nextVideoTrack);
      }
      await localVideoElementRef.current?.play();
    } catch (failure) {
      setCameraPlaybackBlocked(true);
      setCameraFailureReason(cameraAccessHelp(failure));
    } finally {
      for (const track of acquiredTracks) {
        if (!localTracksRef.current.includes(track)) track.stop();
      }
      setCameraRetrying(false);
    }
  };

  const reportCameraPlayback = (blocked: boolean) => {
    setCameraFrameReady(!blocked);
    setCameraPlaybackBlocked(blocked);
    setCameraFailureReason(blocked
      ? "This page has not received a camera frame. If this is an in-app browser, open the link in Chrome or Brave and allow Camera access."
      : "");
  };

  const toggleHostMic = async () => {
    const next = !audioEnabled;
    try {
      await roomRef.current?.localParticipant.setMicrophoneEnabled(next);
      setAudioEnabled(next);
    } catch {
      setError("The microphone could not be updated.");
    }
  };

  const openLiveGiftFlow = () => {
    window.dispatchEvent(new CustomEvent("streamtalk:open-live-gifts", { detail: { streamId } }));
  };

  const shareLiveStream = async () => {
    const basePath = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    const url = new URL(`${basePath}live/${encodeURIComponent(streamId)}`, window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title: `${displayName} is live on Streamtalk`, text: "Join my live stream", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareNotice("Stream link copied");
      if (shareNoticeTimer.current) window.clearTimeout(shareNoticeTimer.current);
      shareNoticeTimer.current = window.setTimeout(() => setShareNotice(""), 2400);
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError") return;
      setError("Could not share the stream link.");
    }
  };

  const leave = async () => {
    leavingRef.current = true;
    await roomRef.current?.disconnect();
    onLeave?.();
  };

  return (
      <div className={`st-live-room${hostMode ? " is-host" : " is-viewer"}${hostMode && cameraFacing === "user" ? " is-front-camera" : ""}`}
      style={{ backgroundColor: "#000", width: "100%", height: "100dvh", minHeight: "100dvh", border: 0, borderRadius: 0, boxShadow: "none" }}
      data-testid="live-room">
      <div className="st-live-player" style={{ backgroundColor: "#000", border: 0, borderRadius: 0, boxShadow: "none" }}>
        {videoTrack ? <StreamTrack track={videoTrack} kind="video" muted={hostMode}
          onPlaybackBlocked={hostMode ? reportCameraPlayback : undefined}
          onVideoElement={element => { localVideoElementRef.current = element; }} /> : (
          !hostMode && <div className="st-live-player-empty">
            <span className="st-live-avatar">
              {hostAvatarEmoji ?? (hostAvatarUrl ? <img src={hostAvatarUrl} alt="" /> : [...displayName][0]?.toUpperCase() ?? "S")}
            </span>
            <strong>{displayName}</strong>
            <span>{status === "connecting" ? "Starting your camera…" : "Your camera preview is unavailable."}</span>
          </div>
        )}
        {hostMode && (!cameraFrameReady || cameraPlaybackBlocked || !videoTrack) && status !== "ending" && status !== "ended" && (
          <div className="st-live-camera-recovery" data-testid="live-camera-recovery">
            <strong>{cameraPlaybackBlocked || !videoTrack && status !== "connecting" ? "Camera preview is unavailable" : "Starting your camera…"}</strong>
            <span>{cameraFailureReason || (status === "connecting"
              ? "Waiting for the first camera frame. If this is an in-app browser, open the link in Chrome or Brave."
              : "Allow camera access to show your live video. If this is an in-app browser, open the link in Chrome or Brave.")}</span>
            <button type="button" onClick={() => void startCameraFromTap()} disabled={cameraRetrying}
              data-testid="live-start-camera">{cameraRetrying ? "Starting camera…" : "Tap to start camera"}</button>
          </div>
        )}
        {audioTrack && !hostMode && <StreamTrack track={audioTrack} kind="audio"
          onPlaybackBlocked={() => setAudioEnabled(false)} />}
        <div className="st-live-topbar">
          <div className="st-live-creator">
            <button type="button" className="st-live-creator-profile" disabled={hostMode || !hostUsername}
              onClick={() => !hostMode && hostUsername && setProfileAction({ username: hostUsername, displayName })}
              data-testid="live-creator-profile">
              <span className="st-live-creator-avatar" aria-hidden="true">
                {hostAvatarEmoji ?? (hostAvatarUrl ? <img src={hostAvatarUrl} alt="" /> : [...displayName][0]?.toUpperCase() ?? "S")}
              </span>
              <span className="st-live-creator-copy"><strong>{displayName}</strong>
                <small><i className={status === "connected" ? "is-live" : ""} />{status === "connected" ? "LIVE NOW" : status === "reconnecting" ? "Reconnecting" : "Connecting"}</small>
              </span>
            </button>
            {!hostMode && <button type="button" className={`st-live-follow${following ? " is-following" : ""}`}
              onClick={toggleFollow} disabled={!hostUsername || setRelationship.isPending}
              data-testid="live-follow">{following ? "Following" : "Follow"}</button>}
          </div>
          <div className="st-live-top-actions">
            <div className="st-live-viewers" data-testid="live-viewer-count"><Eye size={15} aria-hidden="true" /><span>{viewerCount.toLocaleString()}</span></div>
            <div className="st-live-gifters" aria-label="Top gifters" data-testid="live-top-gifters">
              {gifterTotals.length ? gifterTotals.map(gifter => <LiveGifterAvatar key={gifter.username} {...gifter} />)
                : <small>Top gifters</small>}
            </div>
            {hostMode
              ? <button type="button" className="st-live-close-button st-live-end" disabled={status === "ending" || status === "ended"}
                onClick={() => void end()} aria-label="End stream" data-testid="live-end-stream"><X size={18} /><span>End</span></button>
              : <button type="button" className="st-live-close-button" onClick={() => void leave()} aria-label="Leave live stream" data-testid="live-leave"><X size={19} /></button>}
          </div>
        </div>
        {!hostMode && audioTrack && !audioEnabled && (
          <button type="button" className="st-live-audio-enable" onClick={() => void enableAudio()} data-testid="live-enable-audio">Tap to hear stream</button>
        )}
        {!hostMode && <button type="button" className="st-live-report-stream" onClick={openStreamReport}
          aria-label="Report stream" data-testid="live-report-stream"><Flag size={16} /></button>}
        {error && <p className="st-live-error" role="alert" data-testid="live-error">{error}</p>}
        {shareNotice && <div className="st-live-share-status" role="status">{shareNotice}</div>}
        <div className="st-live-chat-overlay">
          {visibleJoinNotice && <div className="st-live-join-banner" role="status" data-testid="live-join-banner">
            <strong>{visibleJoinNotice}</strong> joined
          </div>}
          <LiveChat room={room} streamId={streamId} ownUsername={ownUsername} blockedUsernames={blockedUsernames}
            onProfile={target => setProfileAction(target)}
            onReportMessage={target => setReportTarget({ ...target, streamId })}
            onGift={receiveLiveGift} />
        </div>
        <div className="st-live-bottom-controls">
          {!hostMode ? <button type="button" className="st-live-gift-button" onClick={openLiveGiftFlow}
            aria-label="Open live gifts" data-testid="live-open-gifts"><Gift size={20} /><span>Gift</span></button>
            : <div className="st-live-host-controls">
            <button type="button" onClick={() => void flipCamera()} aria-label="Flip camera"
              data-testid="live-flip-camera"><FlipHorizontal size={18} /><span>Flip</span></button>
            <button type="button" className={audioEnabled ? "is-mic-on" : "is-mic-off"} onClick={() => void toggleHostMic()}
              aria-label={audioEnabled ? "Mute microphone" : "Unmute microphone"} aria-pressed={audioEnabled}
              data-testid="live-toggle-mic">{audioEnabled ? <Mic size={18} /> : <MicOff size={18} />}<span>{audioEnabled ? "Mic on" : "Mic off"}</span></button>
            <button type="button" onClick={() => void shareLiveStream()} aria-label="Share stream link"
              data-testid="live-share-stream"><Share2 size={18} /><span>Share</span></button>
          </div>}
        </div>
      </div>
      {giftOpen && !hostMode && hostUsername && <GiftBag recipient={{ username: hostUsername, displayName }}
        streamId={streamId} onClose={closeLiveGiftPanel} />}
      {activeGift && activeGift.giftId === "heart" && <HeartAnimation key={activeGift.id} onFinish={() => finishLiveGift(activeGift.id)} />}
      {activeGift && activeGift.giftId === "spirit-pup" && <SpiritAnimation key={activeGift.id} onFinish={() => finishLiveGift(activeGift.id)} />}
      {activeGift && activeGift.giftId === "moonfox" && <MoonfoxAnimation key={activeGift.id} onFinish={() => finishLiveGift(activeGift.id)} />}
      {activeGift && activeGift.giftId === "cosmic-encore" && <CosmicEncoreAnimation key={activeGift.id} onFinish={() => finishLiveGift(activeGift.id)} />}
      {profileAction && <div className="st-live-action-scrim" onClick={() => setProfileAction(null)}>
        <section className="st-live-action-sheet" role="dialog" aria-modal="true"
          aria-label={`Actions for ${profileAction.displayName}`} onClick={event => event.stopPropagation()}>
          <button type="button" className="st-live-action-close" aria-label="Close" onClick={() => setProfileAction(null)} data-testid="live-profile-close"><X size={18} /></button>
          <span className="st-live-action-avatar" aria-hidden="true">{[...profileAction.displayName][0]?.toUpperCase() ?? "S"}</span>
          <h2>{profileAction.displayName}</h2>
          <button type="button" onClick={() => { setReportTarget({ targetType: "user", targetUsername: profileAction.username, streamId }); setProfileAction(null); }}>
             <Flag size={16} /> Report user
          </button>
          {!hostMode && <button type="button" onClick={() => { openStreamReport(); setProfileAction(null); }}>
            <Flag size={16} /> Report stream
          </button>}
          <button type="button" disabled={setRelationship.isPending} onClick={blockSelectedUser}>
            <Ban size={16} /> Block
          </button>
        </section>
      </div>}
      {reportTarget && <SafetyReportDialog targetType={reportTarget.targetType}
        targetUsername={reportTarget.targetUsername}
        streamId={reportTarget.streamId ?? (reportTarget.targetType === "stream" || reportTarget.targetType === "message" ? streamId : undefined)}
        messageText={reportTarget.messageText} messageId={reportTarget.messageId}
        onClose={() => setReportTarget(null)} />}
    </div>
  );
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
    const timer = window.setInterval(() => void refresh(), 8_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return (
    <main className="st-live-page">
      <header className="st-live-page-head">
        <Link href="/home" className="st-live-back"><ArrowLeft size={18} /> Directory</Link>
        <h1>Live creators</h1>
        <p>Watch and chat with creators who are live now.</p>
      </header>
      {loading && <p className="st-live-muted">Checking for live streams…</p>}
      {error && <p className="st-live-error" role="alert">{error}</p>}
      {!loading && !error && streams.length === 0 && (
        <section className="st-live-empty"><Radio size={28} /><strong>No creator streams right now</strong><span>When someone goes live, they’ll appear here.</span></section>
      )}
      <div className="st-live-directory-grid">
        {streams.map(stream => (
          <Link className="st-live-directory-card" href={`/live/${stream.streamId}`} key={stream.streamId}>
            <div className="st-live-directory-thumb"><Video size={30} /><span className="st-live-state is-live"><i /> LIVE</span></div>
            <strong>{stream.displayName}</strong>
            <span><Users size={15} /> {stream.viewerCount} watching</span>
            <b>Watch live</b>
          </Link>
        ))}
      </div>
    </main>
  );
}

export function StartLiveStreamPage() {
  const [session, setSession] = useState<HostStartSession | null>(() => pendingLiveHostStart?.session ?? null);
  const [hostTracks, setHostTracks] = useState<LocalTrack[]>(() => pendingLiveHostStart?.tracks ?? []);
  const [finished, setFinished] = useState(false);
  useEffect(() => { pendingLiveHostStart = null; }, []);
  const ended = () => {
    for (const track of hostTracks) track.stop();
    setSession(null);
    setHostTracks([]);
    setFinished(true);
  };

  if (!session) {
    return (
      <main className="st-live-page st-live-start-fallback">
        <Link href="/home" className="st-live-back"><ArrowLeft size={18} /> Directory</Link>
        <h1>{finished ? "Your stream has ended" : "Start Go Live from Streamtalk"}</h1>
        {!finished && <p>Use the Go Live button in the header or Directory to request camera and microphone access and start broadcasting.</p>}
        <Link href="/home" className="st-live-start-button">Back to Directory</Link>
      </main>
    );
  }

  return (
    <main className="st-live-page st-live-host-page" style={{ backgroundColor: "#000", width: "100%", maxWidth: "none", height: "100dvh", minHeight: "100dvh", margin: 0, padding: 0, border: 0, borderRadius: 0, boxShadow: "none" }}>
      <LiveRoomView streamId={session.streamId} hostMode hostSession={session}
        hostTracks={hostTracks} onEnded={ended} />
    </main>
  );
}

export function WatchLiveStreamPage({ streamId }: { streamId: string }) {
  const [closed, setClosed] = useState(false);
  const [, navigate] = useLocation();
  return (
    <main className="st-live-page st-live-viewer-page" style={{ backgroundColor: "#000", width: "100%", maxWidth: "none", height: "100dvh", minHeight: "100dvh", margin: 0, padding: 0, border: 0, borderRadius: 0, boxShadow: "none" }}>
      {closed ? <section className="st-live-empty"><strong>This stream has ended</strong><Link href="/live">Browse live creators</Link></section>
      : <LiveRoomView key={streamId} streamId={streamId} hostMode={false}
          onEnded={() => setClosed(true)} onLeave={() => navigate("/live")} />}
    </main>
  );
}

