import type { Identity } from '../types';
import { IdentityGlyph } from './IdentityGlyph';
import { ShinyName } from '@/components/ShinyName';

const SIZES = { sm: 28, md: 48, lg: 88 } as const;

interface Props {
  handle: string;
  displayNameColor?: string;
  displayNameTierIndex?: number;
  identity: Identity;
  size?: keyof typeof SIZES;
  simulated?: boolean;
  showHandle?: boolean;
}

export function ParticipantEmojiBadge({ handle, displayNameColor, displayNameTierIndex, identity, size = 'md', simulated, showHandle = false }: Props) {
  return (
    <div className={`bm-badge bm-badge-${size}`} data-testid={`badge-${handle}`} title={simulated ? `${handle} (simulated)` : handle}>
      <IdentityGlyph identity={identity} size={SIZES[size]} />
      {showHandle && (
        <span className="bm-badge-handle">
          <ShinyName displayNameColor={displayNameColor} displayNameTierIndex={displayNameTierIndex}>{handle}</ShinyName>
        </span>
      )}
    </div>
  );
}
