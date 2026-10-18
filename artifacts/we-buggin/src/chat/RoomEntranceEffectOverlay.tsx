import { useEffect, useRef, useState } from "react";
import type { RoomEntranceEffectEvent } from "./useTextRoom";
import { ShinyName } from "@/components/ShinyName";
import { GiftAnimationPlayer } from "@/gifts/GiftAnimationPlayer";
import type { GiftStudioGiftId } from "@workspace/api-client-react";

type EffectAsset = { webmSrc: string; webpSrc: string };
const BASE = import.meta.env.BASE_URL;
const lionUrl = (filename: string) => `${BASE}api/room-entry-effects/lion/${filename}?v=4`;
const tierUrl = (tier: string, filename: string) =>
  `${BASE}api/room-entry-effects/monthly-credit-tiers/${tier}/${filename}?v=2`;
const tierNumber = (effectId: string) => /^monthly-tier-([1-5])$/.exec(effectId)?.[1] ?? null;
const HOLD_LAST_FRAME_MS = 2_000;
const FADE_OUT_MS = 500;
const STATIC_GIFT_IDS = new Set([
  "good-vibes", "big-love", "standing-ovation", "heart", "spirit-pup",
  "moonfox", "cosmic-encore", "fireworks", "rose-shower", "whip",
]);

function shouldUseAnimatedWebp() {
  const ua = navigator.userAgent;
  const appleMobile = /iPhone|iPad|iPod/i.test(ua)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR/i.test(ua);
  if (appleMobile || safari) return true;
  const video = document.createElement("video");
  return !video.canPlayType('video/webm; codecs="vp9"');
}

export function RoomEntranceEffectOverlay({
  event,
  onFinish,
}: {
  event: RoomEntranceEffectEvent | null;
  onFinish: (eventId: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaEndTimerRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const beginHoldRef = useRef<() => void>(() => {});
  const [asset, setAsset] = useState<EffectAsset | null>(null);
  const [staticGiftPlayer, setStaticGiftPlayer] = useState(false);
  const [useWebp, setUseWebp] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    setAsset(null);
    setStaticGiftPlayer(false);
    setUnavailable(false);
    setFading(false);
    beginHoldRef.current = () => {};
    if (!event) return;
    const elapsed = Math.max(0, Date.now() - event.startedAt);
    const remaining = Math.max(0, event.durationMs - elapsed);
    if (!remaining) {
      onFinish(event.eventId);
      return;
    }

    let holding = false;
    const beginHoldAndFade = () => {
      if (holding) return;
      holding = true;
      if (mediaEndTimerRef.current !== null) window.clearTimeout(mediaEndTimerRef.current);
      holdTimerRef.current = window.setTimeout(() => {
        setFading(true);
        fadeTimerRef.current = window.setTimeout(() => onFinish(event.eventId), FADE_OUT_MS);
      }, HOLD_LAST_FRAME_MS);
    };
    beginHoldRef.current = beginHoldAndFade;

    let webmSrc: string | null = null;
    let webpSrc: string | null = null;
    if (event.effectId === "lion-entrance") {
      webmSrc = lionUrl("animation.webm");
      webpSrc = lionUrl("animation.webp");
    } else if (event.studioVersionId) {
      webmSrc = `${BASE}api/social/gift-studio/media/${event.studioVersionId}/webm`;
      webpSrc = `${BASE}api/social/gift-studio/media/${event.studioVersionId}/safari`;
    } else {
      const tier = tierNumber(event.effectId);
      if (tier && ["2", "3", "4"].includes(tier)) {
        webmSrc = tierUrl(tier, "animation.webm");
        webpSrc = tierUrl(tier, "animation.webp");
      }
    }

    // Tier 1 and 5 do not have uploaded entrance animations yet. Never substitute
    // their badge art here; badge art is reserved for username/profile display.
    if (!webmSrc || !webpSrc) {
      if (STATIC_GIFT_IDS.has(event.effectId)) {
        setStaticGiftPlayer(true);
        return;
      }
      onFinish(event.eventId);
      return;
    }

    setUseWebp(shouldUseAnimatedWebp());
    setAsset({ webmSrc, webpSrc });
    // A safety timer covers a media element that never reaches its ended event.
    mediaEndTimerRef.current = window.setTimeout(beginHoldAndFade, remaining + 5_000);
    return () => {
      if (mediaEndTimerRef.current !== null) window.clearTimeout(mediaEndTimerRef.current);
      if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
      if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
      mediaEndTimerRef.current = null;
      holdTimerRef.current = null;
      fadeTimerRef.current = null;
      videoRef.current?.pause();
      videoRef.current = null;
    };
  }, [event?.eventId, event?.effectId, event?.startedAt, event?.durationMs, onFinish]);

  if (!event || unavailable) return null;
  if (staticGiftPlayer) {
    return (
      <>
        <div className={`ur-room-entry-effect${fading ? " is-fading" : ""}`} aria-hidden="true">
          <span className="ur-entry-effect-caption"><ShinyName displayNameColor={event.displayNameColor} displayNameTierIndex={event.displayNameTierIndex}>{event.displayName}</ShinyName> · {event.effectName ?? "Entrance effect"}</span>
        </div>
        <GiftAnimationPlayer
          giftId={event.effectId as GiftStudioGiftId}
          senderName={event.displayName}
          senderNameColor={event.displayNameColor}
          senderNameTierIndex={event.displayNameTierIndex}
          onFinish={() => onFinish(event.eventId)}
        />
      </>
    );
  }
  if (!asset) return null;
  const elapsed = Math.max(0, Date.now() - event.startedAt);
  const fallbackToAnimationImage = () => setUseWebp(true);
  const startWebpHoldTimer = () => {
    if (mediaEndTimerRef.current !== null) window.clearTimeout(mediaEndTimerRef.current);
    mediaEndTimerRef.current = window.setTimeout(
      () => beginHoldRef.current(),
      event.durationMs,
    );
  };

  return (
    <div
      className={`ur-room-entry-effect${fading ? " is-fading" : ""}`}
      aria-hidden="true"
      data-testid="room-entrance-effect"
      data-effect-id={event.effectId}
    >
      <span className="ur-entry-effect-caption">
        <ShinyName displayNameColor={event.displayNameColor} displayNameTierIndex={event.displayNameTierIndex}>{event.displayName}</ShinyName> · {event.effectName ?? "Entrance effect"}
      </span>
      {useWebp ? (
        <img
          className="ur-entry-effect-webp"
          src={asset.webpSrc}
          alt=""
          draggable={false}
          onLoad={startWebpHoldTimer}
          onError={() => {
            setUnavailable(true);
            if (mediaEndTimerRef.current !== null) window.clearTimeout(mediaEndTimerRef.current);
            if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
            if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
            onFinish(event.eventId);
          }}
        />
      ) : (
        <video
          ref={videoRef}
          className="ur-entry-effect-video"
          src={asset.webmSrc}
          autoPlay
          muted
          playsInline
          preload="auto"
          controls={false}
          disablePictureInPicture
          onLoadedMetadata={video => {
            const current = video.currentTarget;
            if (elapsed > 0 && Number.isFinite(current.duration) && elapsed / 1000 < current.duration) {
              try { current.currentTime = elapsed / 1000; } catch { /* Wait for playable data. */ }
            }
            void current.play().catch(fallbackToAnimationImage);
          }}
          onError={fallbackToAnimationImage}
          onEnded={() => beginHoldRef.current()}
        />
      )}
    </div>
  );
}
