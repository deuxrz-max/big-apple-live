import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  getGetActiveGiftStudioMediaQueryKey,
  useGetActiveGiftStudioMedia,
  getGetGiftMotionPlaybackQueryKey,
  useGetGiftMotionPlayback,
} from "@workspace/api-client-react";
import type { DeveloperGiftMotion, GiftStudioGiftId, GiftStudioPlaybackMedia, SocialGiftCatalogId } from "@workspace/api-client-react";
import { HeartAnimation } from "./HeartAnimation";
import { BigTierGiftAnimation, isBigTierGiftId } from "./BigTierGift";
import { CosmicEncoreAnimation, MoonfoxAnimation, SpiritAnimation } from "./SpiritPup";
import "./gifts.css";
import "./gift-motion-overlay.css";

const isMotionGiftId = (id: string) => /^motion-[0-9a-f-]{36}$/.test(id);
const GiftMotionPreview = lazy(() => import("./GiftMotionPreview").then((module) => ({ default: module.GiftMotionPreview })));

const PRESENTATION: Record<GiftStudioGiftId, { name: string; emoji: string; position: "top" | "full" | "bottom" | "center" }> = {
  "good-vibes": { name: "Good vibes", emoji: "✨", position: "center" },
  "big-love": { name: "Big love", emoji: "💖", position: "center" },
  "standing-ovation": { name: "Standing ovation", emoji: "👏", position: "center" },
  heart: { name: "Heart", emoji: "❤️", position: "center" },
  "spirit-pup": { name: "Spirit Pup", emoji: "🐶", position: "center" },
  moonfox: { name: "Moonfox", emoji: "🦊", position: "center" },
  "cosmic-encore": { name: "Cosmic Encore", emoji: "✨", position: "full" },
  fireworks: { name: "Fireworks", emoji: "🎆", position: "top" },
  "rose-shower": { name: "Rose Shower", emoji: "🌹", position: "full" },
  whip: { name: "Whip", emoji: "🏎️", position: "bottom" },
};

export function giftStudioMediaUrl(url: string): string {
  if (/^(https?:)?\/\//i.test(url)) return url;
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}${url.replace(/^\/+/, "")}`;
}

const prefersAnimatedImage = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
  || (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent));

export function GiftAnimationPlayer({
  giftId,
  senderName,
  senderNameColor,
  senderNameTierIndex,
  onFinish,
  mediaOverride,
}: {
  giftId: GiftStudioGiftId;
  senderName: string;
  senderNameColor?: string;
  senderNameTierIndex?: number;
  onFinish: () => void;
  mediaOverride?: GiftStudioPlaybackMedia;
}) {
  const isMotionGift = isMotionGiftId(giftId);
  const activeQuery = useGetActiveGiftStudioMedia(giftId, {
    query: {
      queryKey: getGetActiveGiftStudioMediaQueryKey(giftId),
      enabled: !mediaOverride && !isMotionGift,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      retry: false,
    },
  });
  const motionQuery = useGetGiftMotionPlayback(giftId as SocialGiftCatalogId, {
    query: {
      queryKey: getGetGiftMotionPlaybackQueryKey(giftId as SocialGiftCatalogId),
      enabled: isMotionGift && !mediaOverride,
      staleTime: 0,
      refetchOnMount: "always",
      retry: false,
    },
  });
  const [manifestTimedOut, setManifestTimedOut] = useState(false);
  const motionFinishRef = useRef(onFinish);
  motionFinishRef.current = onFinish;

  useEffect(() => {
    if (!isMotionGift || motionQuery.data) return;
    const timeout = window.setTimeout(() => motionFinishRef.current(), 7000);
    return () => window.clearTimeout(timeout);
  }, [giftId, isMotionGift, motionQuery.data]);

  if (isMotionGift && !mediaOverride) {
    if (!motionQuery.data) return null;
    return <ThreeDimensionalGiftAnimation
      key={motionQuery.data.id}
      gift={motionQuery.data}
      senderName={senderName}
      onFinish={onFinish}
    />;
  }

  useEffect(() => {
    if (mediaOverride || !activeQuery.isFetching) {
      setManifestTimedOut(false);
      return;
    }
    setManifestTimedOut(false);
    const timeout = window.setTimeout(() => setManifestTimedOut(true), 2500);
    return () => window.clearTimeout(timeout);
  }, [activeQuery.isFetching, giftId, mediaOverride]);

  const customMedia = mediaOverride ?? (activeQuery.isFetching && !manifestTimedOut
    ? null
    : manifestTimedOut ? null : activeQuery.data?.media ?? null);
  if (customMedia) {
    return <TransparentGiftAnimation
      key={customMedia.versionId}
      giftId={giftId}
      senderName={senderName}
      media={customMedia}
      onFinish={onFinish}
    />;
  }
  if (!mediaOverride && activeQuery.isFetching && !manifestTimedOut) return null;

  if (giftId === "heart") return <HeartAnimation onFinish={onFinish} />;
  if (giftId === "good-vibes" || giftId === "big-love" || giftId === "standing-ovation") {
    return <CatalogIconGiftAnimation giftId={giftId} onFinish={onFinish} />;
  }
  if (giftId === "cosmic-encore") return <CosmicEncoreAnimation onFinish={onFinish} />;
  if (isBigTierGiftId(giftId)) return <BigTierGiftAnimation giftId={giftId} senderName={senderName}
    senderNameColor={senderNameColor} senderNameTierIndex={senderNameTierIndex} onFinish={onFinish} />;
  if (giftId === "moonfox") return <MoonfoxAnimation onFinish={onFinish} />;
  return <SpiritAnimation onFinish={onFinish} />;
}

function ThreeDimensionalGiftAnimation({
  gift,
  senderName,
  onFinish,
}: {
  gift: DeveloperGiftMotion;
  senderName: string;
  onFinish: () => void;
}) {
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const [fading, setFading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const finished = useRef(false);
  useEffect(() => {
    finished.current = false;
    setFading(false);
    const failsafe = window.setTimeout(() => fade(), 15000);
    let fadeTimer = 0;
    function fade() {
      if (finished.current) return;
      finished.current = true;
      setFading(true);
      fadeTimer = window.setTimeout(() => finishRef.current(), 450);
    }
    return () => {
      window.clearTimeout(failsafe);
      window.clearTimeout(fadeTimer);
    };
  }, [gift.id]);
  const fade = () => {
    if (finished.current) return;
    finished.current = true;
    setFading(true);
    window.setTimeout(() => finishRef.current(), 450);
  };
  return createPortal(
    <div className={`gift-motion-overlay${fading ? " is-fading" : ""}`} role="status" aria-live="polite">
      {!previewError && <Suspense fallback={<div className="gift-motion-preview-fallback">Loading 3D gift…</div>}>
        <GiftMotionPreview
          src={gift.fileUrl}
          category={gift.category}
          motion={gift.motion}
          loop={false}
          onModelInfo={() => undefined}
          onError={() => setPreviewError(true)}
          onFinish={fade}
        />
      </Suspense>}
      {previewError && <div className="gift-motion-simple-fallback">
        <strong>{gift.name}</strong><span>3D gift preview is not available on this device.</span>
      </div>}
      <div className="gift-motion-sender-banner">
        <strong>{senderName}</strong><span> sent {gift.name}</span>
      </div>
    </div>,
    document.body,
  );
}

function CatalogIconGiftAnimation({ giftId, onFinish }: {
  giftId: "good-vibes" | "big-love" | "standing-ovation";
  onFinish: () => void;
}) {
  const [fading, setFading] = useState(false);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  useEffect(() => {
    const fade = window.setTimeout(() => setFading(true), 1900);
    const finish = window.setTimeout(() => finishRef.current(), 2300);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(finish);
    };
  }, [giftId]);
  const item = PRESENTATION[giftId];
  return createPortal(
    <div className={`big-tier-gift-overlay big-tier-gift-overlay--center${fading ? " is-fading-out" : ""}`} role="status" aria-live="polite">
      <div className="catalog-icon-gift-preview"><span>{item.emoji}</span><strong>{item.name}</strong></div>
    </div>,
    document.body,
  );
}

function TransparentGiftAnimation({
  giftId,
  senderName,
  media,
  onFinish,
}: {
  giftId: GiftStudioGiftId;
  senderName: string;
  media: GiftStudioPlaybackMedia;
  onFinish: () => void;
}) {
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const finishedRef = useRef(false);
  const [fading, setFading] = useState(false);
  const [useImage, setUseImage] = useState(prefersAnimatedImage);
  const [mediaError, setMediaError] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  const fadeRef = useRef<number | undefined>(undefined);
  const fadeStartedRef = useRef(false);
  const startedWithImage = prefersAnimatedImage();
  const triedImageRef = useRef(startedWithImage);
  const triedVideoRef = useRef(!startedWithImage);
  const completed = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    finishRef.current();
  };
  const fadeOut = () => {
    if (finishedRef.current || fadeStartedRef.current) return;
    fadeStartedRef.current = true;
    setFading(true);
    fadeRef.current = window.setTimeout(completed, 450);
  };

  useEffect(() => {
    finishedRef.current = false;
    fadeStartedRef.current = false;
    setFading(false);
    setMediaError(false);
    triedImageRef.current = prefersAnimatedImage();
    triedVideoRef.current = !triedImageRef.current;
    setUseImage(triedImageRef.current);
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    if (fadeRef.current !== undefined) window.clearTimeout(fadeRef.current);
    const duration = Math.max(500, Math.min(15_000, media.durationMs));
    timerRef.current = window.setTimeout(fadeOut, duration);
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      if (fadeRef.current !== undefined) window.clearTimeout(fadeRef.current);
    };
  }, [media.versionId, media.durationMs]);

  const presentation = { ...PRESENTATION[giftId], name: media.name || PRESENTATION[giftId].name };
  const positionClass = `big-tier-gift-overlay--${presentation.position}`;
  const mediaClass = `big-tier-gift-video big-tier-gift-video--alpha gift-studio-custom-media${fading ? " is-fading-out" : ""}`;
  const src = useImage ? giftStudioMediaUrl(media.safariUrl) : giftStudioMediaUrl(media.webmUrl);

  return createPortal(
    <div className={`big-tier-gift-overlay ${positionClass}${fading ? " is-fading-out" : ""}`}
      role="status" aria-live="polite" data-testid={`gift-studio-animation-${giftId}`}>
      {useImage ? (
        <img
          className={mediaClass}
          src={src}
          alt=""
          aria-hidden="true"
          onError={() => {
            if (!triedVideoRef.current) {
              triedVideoRef.current = true;
              setUseImage(false);
              return;
            }
            setMediaError(true);
            fadeOut();
          }}
        />
      ) : (
        <video
          className={mediaClass}
          src={src}
          autoPlay
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          onCanPlay={(event) => {
            void event.currentTarget.play().catch(() => {
              if (!triedImageRef.current && media.safariUrl) {
                triedImageRef.current = true;
                setUseImage(true);
              } else {
                setMediaError(true);
                fadeOut();
              }
            });
          }}
          onEnded={fadeOut}
          onError={() => {
            if (!triedImageRef.current && media.safariUrl) {
              triedImageRef.current = true;
              setUseImage(true);
              return;
            }
            setMediaError(true);
            fadeOut();
          }}
        />
      )}
      <span className="big-tier-gift-banner">{senderName} sent {presentation.name} {presentation.emoji}</span>
      {mediaError && <span className="big-tier-gift-error" role="status">{presentation.name} animation could not load.</span>}
    </div>,
    document.body,
  );
}
