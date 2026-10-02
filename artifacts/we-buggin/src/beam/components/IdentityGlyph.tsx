import type { Identity } from '../types';
import { getPortrait } from '../portraits';

/** Background-free supplied artwork. Never animated or microphone-driven. */
export function IdentityGlyph({ identity, size = 64 }: { identity: Identity; size?: number | string }) {
  const portrait = getPortrait(identity);
  const base = import.meta.env?.BASE_URL ?? '/';
  return (
    <img
      src={`${base}profile-pictures/transparent/${portrait.file}`}
      alt={`${portrait.label} profile picture`}
      width={size}
      height={size}
      data-portrait-id={portrait.id}
      decoding="async"
      style={{ display: 'block', width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
    />
  );
}