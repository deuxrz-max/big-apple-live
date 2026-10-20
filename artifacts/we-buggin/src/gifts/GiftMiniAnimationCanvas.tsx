import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GiftStudioPlaybackMedia } from "@workspace/api-client-react";
import { roomGiftMiniMedia } from "./SpiritPup";
import { giftStudioMediaUrl } from "./GiftAnimationPlayer";
import type { GiftComboPlan } from "./gift-combo-policy";
import "./gift-combo.css";

type MiniSource = { video?: string; image?: string; still?: string };
type Sprite = { index: number; x: number; y: number; width: number; rotation: number; drift: number };

const EMOJI: Record<string, string> = {
  heart: "❤️", "spirit-pup": "🐶", moonfox: "🦊", "cosmic-encore": "✨",
  fireworks: "🎆", "rose-shower": "🌹", whip: "🏎️",
  "good-vibes": "✨", "big-love": "💖", "standing-ovation": "👏",
};

function prefersAnimatedImage() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
    || (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent));
}

function mixSeed(text: string) {
  let seed = 2166136261;
  for (const char of text) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0;
}

function randomUnit(seed: number) {
  let value = seed >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
}

function getSource(giftId: string, custom?: GiftStudioPlaybackMedia): MiniSource {
  if (custom) return {
    video: custom.webmUrl ? giftStudioMediaUrl(custom.webmUrl) : undefined,
    image: custom.safariUrl ? giftStudioMediaUrl(custom.safariUrl) : undefined,
  };
  const known = roomGiftMiniMedia[giftId as keyof typeof roomGiftMiniMedia];
  return known ?? {};
}

export const GiftMiniAnimationCanvas = memo(function GiftMiniAnimationCanvas({
  giftId,
  comboId,
  giftName,
  quantity,
  plan,
  started,
  customMedia,
  onUnitsLaunched,
  onFinish,
}: {
  giftId: string;
  comboId: string;
  giftName: string;
  quantity: number;
  plan: GiftComboPlan;
  started: boolean;
  customMedia?: GiftStudioPlaybackMedia;
  onUnitsLaunched: (amount: number) => void;
  onFinish: () => void;
}) {
  const source = getSource(giftId, customMedia);
  const [mode, setMode] = useState<"video" | "image" | "still" | "emoji">(() =>
    source.video && !prefersAnimatedImage() ? "video" : source.image ? "image" : source.still ? "still" : "emoji",
  );
  const [imageFailed, setImageFailed] = useState(false);
  const [stillFailed, setStillFailed] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const imageFailedRef = useRef(imageFailed);
  imageFailedRef.current = imageFailed;
  const stillFailedRef = useRef(stillFailed);
  stillFailedRef.current = stillFailed;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const stillRef = useRef<HTMLImageElement>(null);
  const launchCallback = useRef(onUnitsLaunched);
  launchCallback.current = onUnitsLaunched;
  const finishCallback = useRef(onFinish);
  finishCallback.current = onFinish;
  const emoji = EMOJI[giftId] ?? "🎁";

  useEffect(() => {
    setImageFailed(false);
    setStillFailed(false);
    setMode(source.video && !prefersAnimatedImage()
      ? "video" : source.image ? "image" : source.still ? "still" : "emoji");
  }, [source.video, source.image, source.still]);

  useEffect(() => {
    if (!started || mode !== "video") return;
    const video = videoRef.current;
    if (!video) return;
    const startPlayback = () => { void video.play().catch(() => setMode(source.image ? "image" : source.still ? "still" : "emoji")); };
    const failPlayback = () => setMode(source.image ? "image" : source.still ? "still" : "emoji");
    video.addEventListener("canplay", startPlayback);
    video.addEventListener("error", failPlayback);
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) startPlayback();
    return () => {
      video.removeEventListener("canplay", startPlayback);
      video.removeEventListener("error", failPlayback);
      video.pause();
    };
  }, [mode, source.image, source.still, started, source.video]);

  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) {
      const miniDuration = (plan.miniLaunchOffsetsMs.at(-1) ?? 0) + plan.miniDurationMs;
      const timer = window.setTimeout(() => finishCallback.current(), miniDuration);
      return () => window.clearTimeout(timer);
    }

    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    let width = window.innerWidth;
    let height = window.innerHeight;
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const startedAt = performance.now();
    const active: Array<Sprite & { launchedAt: number }> = [];
    const pending: Sprite[] = [];
    let nextIndex = 0;
    let frameId = 0;
    let finished = false;
    const seed = mixSeed(`${giftId}:${comboId}`);
    const maxConcurrent = plan.maxConcurrent;

    const makeSprite = (index: number): Sprite => {
      const a = randomUnit(seed + index * 3 + 1);
      const b = randomUnit(seed + index * 3 + 2);
      const c = randomUnit(seed + index * 3 + 3);
      const available = Math.min(width * (plan.reducedMotion ? 0.31 : 0.42), plan.reducedMotion ? 132 : 210);
      return {
        index,
        x: width * (0.12 + a * 0.76),
        y: height * (0.17 + b * 0.66),
        width: available * (0.55 + c * 0.45),
        rotation: plan.reducedMotion ? 0 : (a - 0.5) * 0.9,
        drift: plan.reducedMotion ? 0 : (b - 0.5) * Math.min(70, width * 0.14),
      };
    };

    const draw = (now: number) => {
      context.clearRect(0, 0, width, height);
      const currentMode = modeRef.current;
      const media: CanvasImageSource | null = currentMode === "video"
        ? (videoRef.current && videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? videoRef.current : null)
        : currentMode === "image"
          ? (imageRef.current?.complete && imageRef.current.naturalWidth ? imageRef.current : null)
          : currentMode === "still"
            ? (stillRef.current?.complete && stillRef.current.naturalWidth ? stillRef.current : null)
            : null;
      const aspect = media ? (("videoWidth" in media && media.videoWidth > 0)
        ? media.videoWidth / media.videoHeight
        : (media as HTMLImageElement).naturalWidth / (media as HTMLImageElement).naturalHeight) : 1;
      for (let i = active.length - 1; i >= 0; i -= 1) {
        const sprite = active[i]!;
        const progress = Math.max(0, Math.min(1, (now - sprite.launchedAt) / plan.miniDurationMs));
        if (progress >= 1) {
          active.splice(i, 1);
          continue;
        }
        const fade = Math.min(1, progress / 0.13, (1 - progress) / 0.27);
        const floatY = plan.reducedMotion ? 0 : Math.sin(progress * Math.PI * 2) * 13;
        const w = sprite.width;
        const h = w / Math.max(0.35, Math.min(2.8, aspect || 1));
        context.save();
        context.globalAlpha = Math.max(0, fade) * (plan.reducedMotion ? 0.92 : 1);
        context.translate(sprite.x + sprite.drift * progress, sprite.y + floatY);
        context.rotate(sprite.rotation * (1 - progress));
        if (media) {
          context.drawImage(media, -w / 2, -h / 2, w, h);
        } else {
          context.font = `${Math.round(w * 0.8)}px system-ui, sans-serif`;
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.shadowColor = "rgba(12, 6, 22, 0.45)";
          context.shadowBlur = plan.reducedMotion ? 0 : 9;
          context.fillText(emoji, 0, 0);
        }
        context.restore();
      }
    };

    const frame = (now: number) => {
      const elapsed = now - startedAt;
      while (nextIndex < plan.miniLaunchOffsetsMs.length
        && elapsed >= plan.miniLaunchOffsetsMs[nextIndex]!) {
        pending.push(makeSprite(nextIndex));
        nextIndex += 1;
      }
      let launched = 0;
      while (pending.length && active.length < maxConcurrent) {
        active.push({ ...pending.shift()!, launchedAt: now });
        launched += 1;
      }
      if (launched) launchCallback.current(launched);
      draw(now);
      if (nextIndex === plan.miniLaunchOffsetsMs.length && pending.length === 0 && active.length === 0) {
        if (!finished) {
          finished = true;
          finishCallback.current();
        }
        return;
      }
      frameId = window.requestAnimationFrame(frame);
    };
    frameId = window.requestAnimationFrame(frame);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
    };
  }, [comboId, emoji, giftId, plan, started]);

  const imageUrl = mode === "image" ? source.image : source.still;
  return createPortal((
    <div className="gift-mini-source" aria-hidden="true">
      <span hidden data-gift-name={giftName} data-quantity={quantity} />
      {mode === "video" && source.video && <video ref={videoRef} src={source.video} muted loop playsInline preload="auto" />}
      {imageUrl && mode !== "video" && <img
        ref={mode === "image" ? imageRef : stillRef}
        src={imageUrl}
        alt=""
        onError={() => mode === "image" ? setImageFailed(true) : setStillFailed(true)}
      />}
      <canvas
        ref={canvasRef}
        className={`gift-mini-canvas${customMedia?.backgroundMode === "black" ? " is-black-background" : ""}`}
        aria-hidden="true"
      />
    </div>
  ), document.body);
});
