import type { CSSProperties, ReactNode } from 'react';
import './shiny-name.css';

export interface ShinyNameProps {
  children: ReactNode;
  displayNameColor?: string | null;
  displayNameTierIndex?: number | null;
  className?: string;
}

/**
 * The server's tier index is the gifting level; its color still preserves the
 * existing username treatment. Only the prefixed logo takes the gifting color.
 */
export function ShinyName({
  children,
  displayNameColor,
  displayNameTierIndex = 0,
  className = '',
}: ShinyNameProps) {
  const giftingLevel = Number.isFinite(displayNameTierIndex)
    ? Math.max(0, Math.min(18, Math.floor(displayNameTierIndex ?? 0)))
    : 0;
  const legacyColors = ['#FFFFFF', '#E4E4E4', '#C0C0C0', '#FFD700', '#EDEBAD', '#FFFF00',
    '#00FFFF', '#A8DADC', '#00FF00', '#98FF98', '#FF0099', '#FFC1CC',
    '#B39CD0', '#FF00FF', '#FFDAB9', '#87CEEB', '#F39C12', '#F5F5DC', '#09B0EC'];
  const tier = Math.max(0, legacyColors.indexOf(displayNameColor?.toUpperCase() ?? '#FFFFFF'));
  const levelNames = [
    'Pure White', 'Light Gray', 'Silver', 'Gold', 'Pale Khaki', 'Yellow', 'Cyan',
    'Powder Blue', 'Bright Lime Green', 'Mint Green', 'Hot Pink',
    'Light Bubblegum Pink', 'Lavender', 'Magenta', 'Peach', 'Sky Blue',
    'Orange', 'Beige', 'Bright Blue',
  ];
  // Keep the existing unearned/default presentation; earned logos use the exact
  // original palette, without changing the independent username color mapping.
  const level = giftingLevel > 0
    ? { name: levelNames[giftingLevel], color: legacyColors[giftingLevel] }
    : null;
  const style = tier > 0 && displayNameColor
    ? { '--shiny-name-color': displayNameColor } as CSSProperties
    : undefined;

  return (
    <span className={`shiny-name-label${className ? ` ${className}` : ''}`}>
      {level && (
        <span className="gifting-level-logo" role="img" aria-label={`${level.name} gifting level`}
          title={`${level.name} gifting level`} data-gifting-level={giftingLevel}
          style={{
            '--gifting-level-color': level.color,
            '--gifting-logo-url': `url("${import.meta.env.BASE_URL}brand/deux-wild-logo.png")`,
          } as CSSProperties}>
          <span className="gifting-level-logo-art" />
        </span>
      )}
      <span className="shiny-name" data-tier={tier} style={style}>{children}</span>
    </span>
  );
}
