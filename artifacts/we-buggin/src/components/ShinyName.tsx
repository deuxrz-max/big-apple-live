import type { CSSProperties, ReactNode } from 'react';
import './shiny-name.css';

export interface ShinyNameProps {
  children: ReactNode;
  displayNameColor?: string | null;
  displayNameTierIndex?: number | null;
  className?: string;
}

export function ShinyName({
  children,
  displayNameColor = '#f5f4ef',
  displayNameTierIndex = 0,
  className = '',
}: ShinyNameProps) {
  return (
    <span className={`shiny-name-label${className ? ` ${className}` : ''}`} style={{ '--name-color': displayNameColor ?? '#f5f4ef' } as CSSProperties}>
      <span className="shiny-name" data-tier={displayNameTierIndex ? '1' : '0'}>{children}</span>
    </span>
  );
}
