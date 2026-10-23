import type { Identity } from '../types';
import { NeutralAvatar } from '@/components/neutral-avatar';

/** Retired preset portraits are no longer drawn; every saved preset ID falls back to a neutral default. */
export function IdentityGlyph({ size = 64, name, fill }: { identity?: Identity; size?: number | string; name?: string | null; fill?: boolean }) {
  return <NeutralAvatar name={name} size={size} fill={fill} />;
}
