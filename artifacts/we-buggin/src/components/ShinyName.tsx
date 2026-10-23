import type { CSSProperties, ReactNode } from 'react';
import { giftingTier } from '@workspace/beam-identity';
import { GiftingShield } from '@/gifting/GiftingShield';
import { giftingPerks, normalizeGiftingLevel } from '@/gifting/gifting';
import './shiny-name.css';

export interface ShinyNameProps {
  children: ReactNode;
  displayNameColor?: string | null;
  displayNameTierIndex?: number | null;
  className?: string;
  /** Set false where the numbered shield is rendered separately. */
  showShield?: boolean;
}

const LEGACY_NAME_COLORS = ['#FFFFFF', '#E4E4E4', '#C0C0C0', '#FFD700', '#EDEBAD', '#FFFF00',
  '#00FFFF', '#A8DADC', '#00FF00', '#98FF98', '#FF0099', '#FFC1CC',
  '#B39CD0', '#FF00FF', '#FFDAB9', '#87CEEB', '#F39C12', '#F5F5DC', '#09B0EC'];

/**
 * `displayNameTierIndex` is the gifting level (0..100). The prefixed mark is
 * the numbered gifting shield. A legacy purchased username color always wins;
 * otherwise Silver+ gifters get their tier color as a chat-name perk.
 */
export function ShinyName({
  children,
  displayNameColor,
  displayNameTierIndex = 0,
  className = '',
  showShield = true,
}: ShinyNameProps) {
  const level = normalizeGiftingLevel(displayNameTierIndex);
  const tier = Math.max(0, LEGACY_NAME_COLORS.indexOf(displayNameColor?.toUpperCase() ?? '#FFFFFF'));
  const hasLegacyColor = tier > 0 && !!displayNameColor;
  const perkColor = !hasLegacyColor && giftingPerks(level).tierNameColor ? giftingTier(level).color : null;
  const style = hasLegacyColor
    ? { '--shiny-name-color': displayNameColor } as CSSProperties
    : perkColor ? { '--gifting-name-color': perkColor } as CSSProperties : undefined;

  return (
    <span className={`shiny-name-label${className ? ` ${className}` : ''}`}>
      {showShield && level > 0 && <GiftingShield level={level} size={17} />}
      <span className={`shiny-name${perkColor ? ' shiny-name--gifting-perk' : ''}`} data-tier={tier}
        data-gifting-tier={perkColor ? giftingTier(level).key : undefined} style={style}>{children}</span>
    </span>
  );
}
