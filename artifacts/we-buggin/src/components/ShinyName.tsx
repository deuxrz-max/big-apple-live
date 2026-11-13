import type { ReactNode } from 'react';
import './shiny-name.css';

export interface ShinyNameProps {
  children: ReactNode;
  displayNameColor?: string | null;
  displayNameTierIndex?: number | null;
  className?: string;
}

export function ShinyName({
  children,
  className = '',
}: ShinyNameProps) {
  return (
    <span className={`shiny-name-label${className ? ` ${className}` : ''}`}>
      <span className="shiny-name">{children}</span>
    </span>
  );
}
