import { useEffect, useRef, useState } from "react";
import {
  getGetActiveGiftStudioMediaQueryKey,
  useGetActiveGiftStudioMedia,
} from "@workspace/api-client-react";
import { GiftIcon } from "@/social/common";
import { RoomGiftIcon, type RoomGiftId } from "./SpiritPup";
import { giftMediaUrl } from "./giftMediaUrl";
import "./gift-artwork.css";

const ROOM_GIFT_IDS = new Set<RoomGiftId>([
  "heart", "spirit-pup", "moonfox", "cosmic-encore", "fireworks", "rose-shower", "whip",
]);
const BUILTIN_GIFT_EMOJI: Record<string, string> = {
  "good-vibes": "✨",
  "big-love": "💖",
  "standing-ovation": "👏",
};

/**
 * Shared artwork priority for both the Store and the in-room gift picker:
 * saved icon -> a still captured from the active animation -> built-in art -> fallback icon.
 */
export function GiftArtwork({ gift, size = 52, className = "" }: {
  gift: { id: string; name: string; iconUrl?: string | null };
  size?: number;
  className?: string;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  const [stillFailed, setStillFailed] = useState(false);
  const tryAnimationStill = !gift.iconUrl || iconFailed;

  useEffect(() => {
    setIconFailed(false);
    setStillFailed(false);
  }, [gift.id, gift.iconUrl]);

  const media = useGetActiveGiftStudioMedia(gift.id, {
    query: {
      queryKey: getGetActiveGiftStudioMediaQueryKey(gift.id),
      enabled: tryAnimationStill && !stillFailed,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: false,
    },
  });

  const imageClass = `gift-artwork ${className}`.trim();
  const imageStyle = { width: size, height: size };

  if (gift.iconUrl && !iconFailed) {
    return <img
      className={imageClass}
      src={giftMediaUrl(gift.iconUrl)}
      width={size}
      height={size}
      style={imageStyle}
      alt=""
      aria-hidden="true"
      onError={() => setIconFailed(true)}
    />;
  }

  if (tryAnimationStill && media.data?.media && !stillFailed) {
    return <GiftAnimationStill
      key={`${gift.id}:${media.data.media.versionId}`}
      webmUrl={media.data.media.webmUrl}
      safariUrl={media.data.media.safariUrl}
      size={size}
      className={imageClass}
      onFailure={() => setStillFailed(true)}
    />;
  }

  if (ROOM_GIFT_IDS.has(gift.id as RoomGiftId)) {
    return <RoomGiftIcon giftId={gift.id as RoomGiftId} size={size} className={imageClass} />;
  }

  const emoji = BUILTIN_GIFT_EMOJI[gift.id];
  if (emoji) {
    return <span className={`${imageClass} gift-artwork-emoji`}
      style={{ ...imageStyle, fontSize: Math.round(size * 0.72) }} aria-hidden="true">{emoji}</span>;
  }

  return <GiftIcon id={gift.id} size={size} />;
}

function GiftAnimationStill({ webmUrl, safariUrl, size, className, onFailure }: {
  webmUrl: string;
  safariUrl: string;
  size: number;
  className: string;
  onFailure: () => void;
}) {
  const [stillUrl, setStillUrl] = useState<string | null>(null);
  const failureRef = useRef(onFailure);
  failureRef.current = onFailure;
  const failureSent = useRef(false);

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    let video: HTMLVideoElement | null = null;
    let image: HTMLImageElement | null = null;

    const saveFrame = (source: CanvasImageSource, width: number, height: number) => {
      if (disposed || !width || !height) return false;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) return false;
        const scale = Math.min(size / width, size / height);
        const drawWidth = width * scale;
        const drawHeight = height * scale;
        context.clearRect(0, 0, size, size);
        context.drawImage(source, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight);
        const result = canvas.toDataURL("image/png");
        if (!disposed) {
          window.clearTimeout(timer);
          setStillUrl(result);
        }
        return true;
      } catch {
        return false;
      }
    };

    const trySafariStill = () => {
      image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        timer = window.setTimeout(() => {
          if (image && !saveFrame(image, image.naturalWidth, image.naturalHeight)) markFailed();
        }, 100);
      };
      image.onerror = markFailed;
      image.src = giftMediaUrl(safariUrl);
    };

    const markFailed = () => {
      if (disposed || failureSent.current) return;
      failureSent.current = true;
      failureRef.current();
    };

    video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const captureVideo = () => {
      if (!video || disposed) return;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const frameTime = duration > 0.4 ? Math.min(0.55, duration / 3) : 0;
      const capture = () => {
        if (!video || !saveFrame(video, video.videoWidth, video.videoHeight)) trySafariStill();
      };
      if (frameTime > 0 && Math.abs(video.currentTime - frameTime) > 0.04) {
        video.addEventListener("seeked", capture, { once: true });
        try { video.currentTime = frameTime; } catch { capture(); }
      } else {
        capture();
      }
    };
    video.addEventListener("loadeddata", captureVideo, { once: true });
    video.addEventListener("error", trySafariStill, { once: true });
    video.src = giftMediaUrl(webmUrl);
    video.load();
    timer = window.setTimeout(trySafariStill, 2200);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      if (image) image.src = "";
    };
  }, [safariUrl, size, webmUrl]);

  return stillUrl
    ? <img className={className} src={stillUrl} width={size} height={size} style={{ width: size, height: size }} alt="" aria-hidden="true" />
    : null;
}
