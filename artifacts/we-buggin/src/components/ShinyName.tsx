import type { CSSProperties, ReactNode } from 'react';
import './shiny-name.css';

export interface ShinyNameProps {
  children: ReactNode;
  displayNameColor?: string | null;
  displayNameTierIndex?: number | null;
  className?: string;
}

/**
 * Shared server-driven lifetime-purchase name treatment.
 * Tier zero is deliberately plain white, regardless of any stale color value.
 */
export function ShinyName({
  children,
  displayNameColor,
  displayNameTierIndex = 0,
  className = '',
}: ShinyNameProps) {
  const tier = Number.isFinite(displayNameTierIndex)
    ? Math.max(0, Math.min(18, Math.floor(displayNameTierIndex ?? 0)))
    : 0;
  const style = tier > 0 && displayNameColor
    ? { '--shiny-name-color': displayNameColor } as CSSProperties
    : undefined;

  return (
    <span
      className={`shiny-name${className ? ` ${className}` : ''}`}
      data-tier={tier}
      style={style}
    >
      {children}
    </span>
  );
}
