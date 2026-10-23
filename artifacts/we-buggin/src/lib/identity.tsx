import type { EmojiIdentity } from '@workspace/api-client-react';
import { NeutralAvatar } from '@/components/neutral-avatar';

export type Identity = EmojiIdentity;

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const emojiImageUrl = (emojiId: string, color: string) =>
  `/api/emojis/${encodeURIComponent(emojiId)}/${color.replace('#', '').toUpperCase()}/image`;

interface Props {
  identity: Identity;
  size?: number | string;
  className?: string;
  name?: string | null;
  fill?: boolean;
}

/** Retired preset art (spiky/ponytail portraits, recolored emoji faces) renders as a neutral default. */
export function IdentityAvatar({ size = 120, className, name, fill }: Props) {
  return <NeutralAvatar name={name} size={size} className={className} fill={fill} />;
}

export function InitialsBadge({ name, size = 120 }: { name: string; size?: number }) {
  return (
    <div
      className="grid place-items-center rounded-full bg-muted font-display text-3xl font-bold"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

export function errMessage(e: unknown, fallback = 'Something went wrong. Try again.') {
  const x = e as { data?: { error?: string } | null; message?: string };
  return x?.data?.error ?? x?.message ?? fallback;
}
export const errStatus = (e: unknown) => (e as { status?: number })?.status;
