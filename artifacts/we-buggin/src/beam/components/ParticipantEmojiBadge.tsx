import type { Identity } from '../types';
import { IdentityGlyph } from './IdentityGlyph';

const SIZES = { sm: 28, md: 48, lg: 88 } as const;

interface Props {
  handle: string;
  displayNameColor?: string;
  identity: Identity;
  size?: keyof typeof SIZES;
  simulated?: boolean;
  showHandle?: boolean;
}

export function ParticipantEmojiBadge({ handle, displayNameColor, identity, size = 'md', simulated, showHandle = false }: Props) {
  return (
    <div className={`bm-badge bm-badge-${size}`} data-testid={`badge-${handle}`} title={simulated ? `${handle} (simulated)` : handle}>
      <IdentityGlyph identity={identity} size={SIZES[size]} />
      {showHandle && (
        <span className="bm-badge-handle">
          <span style={{ color: displayNameColor ?? '#FFFFFF' }}>{handle}</span>
        </span>
      )}
    </div>
  );
}
