import { useEffect, useRef, useState } from "react";
import type { RoomEntranceEffectEvent } from "./useTextRoom";
import { isSupportedEntranceEffectContentType, type EntranceEffectAssetKind } from "./entrance-effect-assets";

type EffectAsset = { kind: "lion" | "video" | "image" | "lottie" | "placeholder"; src?: string };
const BASE = import.meta.env.BASE_URL;
const lionUrl = (filename: string) => `${BASE}api/room-entry-effects/lion/${filename}?v=2`;
const tierNumber = (effectId: string) => /^monthly-tier-([1-5])$/.exec(effectId)?.[1] ?? null;
const tierLabel = (event: RoomEntranceEffectEvent) => event.effectName || `Tier ${tierNumber(event.effectId) ?? ""}`;
const tierFolder = (event: RoomEntranceEffectEvent) => event.assetFolder
  ? `${BASE}${event.assetFolder.replace(/^\/+/, "")}`
  : `${BASE}entrance-effects/monthly-credit-tiers/tier${tierNumber(event.effectId)}`;
const badgeImage = (event: RoomEntranceEffectEvent) => event.badgeImage
  ? `${BASE}${event.badgeImage.replace(/^\/+/, "")}`
  : `${BASE}badges/monthly-credit-tiers/tier${tierNumber(event.effectId)}.svg`;

export function RoomEntranceEffectOverlay({
  event,
  onFinish,
}: {
  event: RoomEntranceEffectEvent | null;
  onFinish: (eventId: string) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lottieContainerRef = useRef<HTMLDivElement | null>(null);
  const [asset, setAsset] = useState<EffectAsset | null>(null);
  const [posterFallback, setPosterFallback] = useState(false);

  useEffect(() => {
    setAsset(null);
    setPosterFallback(false);
    if (!event) return;
    let cancelled = false;
    const elapsed = Math.max(0, Date.now() - event.startedAt);
    const remaining = Math.max(0, event.durationMs - elapsed);
    if (!remaining) {
      onFinish(event.eventId);
      return;
    }
    const finishTimer = window.setTimeout(() => onFinish(event.eventId), remaining);
    if (event.effectId === "lion-entrance") {
      const audio = new Audio(lionUrl("audio.m4a"));
      audioRef.current = audio;
      audio.preload = "auto";
      try { audio.currentTime = elapsed / 1000; } catch { /* Audio may not have metadata yet. */ }
      setAsset({ kind: "lion", src: lionUrl("animation.webp") });
      return () => {
        cancelled = true;
        window.clearTimeout(finishTimer);
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        if (audioRef.current === audio) audioRef.current = null;
      };
    }

    const directory = tierFolder(event);
    const candidates: Array<[EntranceEffectAssetKind, string]> = [
      ["lottie", `${directory}/entrance.json`],
      ["video", `${directory}/entrance.webm`],
      ["video", `${directory}/entrance.mp4`],
      ["image", `${directory}/entrance.gif`],
      ["image", `${directory}/entrance.webp`],
      ["image", `${directory}/entrance.apng`],
    ];
    void (async () => {
      for (const [kind, src] of candidates) {
        try {
          const response = await fetch(src, { method: "HEAD", cache: "no-store" });
          if (response.ok && isSupportedEntranceEffectContentType(kind, response.headers.get("content-type"))) {
            if (!cancelled) setAsset({ kind, src });
            return;
          }
        } catch { /* Try the next supported extension. */ }
      }
      if (!cancelled) setAsset({ kind: "placeholder" });
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(finishTimer);
    };
  }, [event?.eventId, event?.effectId, event?.startedAt, event?.durationMs, onFinish]);

  useEffect(() => {
    if (!event || asset?.kind !== "lottie" || !asset.src || !lottieContainerRef.current) return;
    let animation: import("lottie-web").AnimationItem | null = null;
    let cancelled = false;
    void import("lottie-web").then(({ default: lottie }) => {
      if (cancelled || !lottieContainerRef.current) return;
      animation = lottie.loadAnimation({
        container: lottieContainerRef.current,
        renderer: "svg",
        loop: false,
        autoplay: false,
        path: asset.src,
      });
      animation.addEventListener("DOMLoaded", () => {
        if (!animation || !event) return;
        const progress = Math.min(0.99, Math.max(0, (Date.now() - event.startedAt) / event.durationMs));
        animation.goToAndPlay(Math.floor(progress * animation.totalFrames), true);
      });
      animation.addEventListener("complete", () => onFinish(event.eventId));
    }).catch(() => {
      if (!cancelled) setAsset({ kind: "placeholder" });
    });
    return () => {
      cancelled = true;
      animation?.destroy();
    };
  }, [asset?.kind, asset?.src, event?.eventId, event?.startedAt, event?.durationMs, onFinish]);

  if (!event || !asset) return null;
  const startLionSound = () => {
    const audio = audioRef.current;
    if (!audio || !audio.paused) return;
    void audio.play().catch(() => {
      audio.muted = true;
      void audio.play().catch(() => {});
    });
  };
  const syncVideo = (video: HTMLVideoElement) => {
    const elapsed = Math.max(0, Date.now() - event.startedAt);
    if (Number.isFinite(video.duration) && video.duration > 0)
      video.currentTime = Math.min(elapsed / 1000, Math.max(0, video.duration - 0.1));
    void video.play().catch(() => {
      video.muted = true;
      void video.play().catch(() => {});
    });
  };

  return (
    <div className="ur-room-entry-effect" aria-hidden="true" data-testid="room-entrance-effect" data-effect-id={event.effectId}>
      {asset.kind === "lion" && <img
        src={posterFallback ? lionUrl("poster.png") : asset.src}
        alt=""
        draggable={false}
        onLoad={startLionSound}
        onError={() => { if (!posterFallback) setPosterFallback(true); }}
      />}
      {asset.kind === "video" && asset.src && <video
        key={asset.src}
        src={asset.src}
        autoPlay
        playsInline
        preload="auto"
        onLoadedMetadata={e => {
          const video = e.currentTarget;
          if (video.videoWidth > 0 && video.videoHeight > 0)
            video.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
          syncVideo(video);
        }}
        onEnded={() => onFinish(event.eventId)}
        onError={() => setAsset({ kind: "placeholder" })}
        aria-hidden="true"
      />}
      {asset.kind === "image" && asset.src && <img src={asset.src} alt="" draggable={false}
        onError={() => setAsset({ kind: "placeholder" })} />}
      {asset.kind === "lottie" && <div className="ur-tier-lottie" ref={lottieContainerRef} />}
      {asset.kind === "placeholder" && <div className="ur-tier-effect-placeholder">
        <img src={badgeImage(event)} alt="" />
        <b>{tierLabel(event)}</b>
      </div>}
    </div>
  );
}
