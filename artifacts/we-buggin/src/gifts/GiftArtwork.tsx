import { useEffect, useState } from "react";
import { GiftIcon } from "@/social/common";
import { giftMediaUrl } from "./giftMediaUrl";
import "./gift-artwork.css";

const BUILTIN_GIFT_EMOJI: Record<string, string> = {
  "good-vibes": "✨",
  "big-love": "💖",
  "standing-ovation": "👏",
};

/** Gift catalog artwork is static; gift animations and Gift Studio playback are retired. */
export function GiftArtwork({ gift, size = 52, className = "" }: {
  gift: { id: string; name: string; iconUrl?: string | null };
  size?: number;
  className?: string;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  useEffect(() => setIconFailed(false), [gift.id, gift.iconUrl]);
  const imageClass = `gift-artwork ${className}`.trim();
  const imageStyle = { width: size, height: size };

  if (gift.iconUrl && !iconFailed) {
    return <img className={imageClass} src={giftMediaUrl(gift.iconUrl)} width={size} height={size}
      style={imageStyle} alt="" aria-hidden="true" onError={() => setIconFailed(true)} />;
  }
  const emoji = BUILTIN_GIFT_EMOJI[gift.id];
  if (emoji) {
    return <span className={`${imageClass} gift-artwork-emoji`}
      style={{ ...imageStyle, fontSize: Math.round(size * 0.72) }} aria-hidden="true">{emoji}</span>;
  }
  return <GiftIcon id={gift.id} size={size} />;
}
