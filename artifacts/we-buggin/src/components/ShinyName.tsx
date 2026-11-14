import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import './shiny-name.css';

export interface ShinyNameProps {
  children: ReactNode;
  displayNameColor?: string | null;
  displayNameTierIndex?: number | null;
  className?: string;
  fitOneLine?: boolean;
}

export function ShinyName({
  children,
  displayNameColor = '#f5f4ef',
  displayNameTierIndex = 0,
  className = '',
  fitOneLine = false,
}: ShinyNameProps) {
  const labelRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!fitOneLine) return;
    const label = labelRef.current;
    const text = label?.querySelector<HTMLElement>('.shiny-name');
    if (!label || !text) return;

    let cancelled = false;
    const fit = () => {
      text.style.fontSize = '';
      const availableWidth = label.clientWidth;
      const baseSize = Number.parseFloat(getComputedStyle(text).fontSize);
      const textWidth = text.scrollWidth;
      if (availableWidth > 0 && textWidth > availableWidth && baseSize > 0) {
        text.style.fontSize = `${Math.max(4, baseSize * availableWidth / textWidth * 0.98)}px`;
      }
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(label);
    document.fonts?.ready.then(() => {
      if (!cancelled) fit();
    });

    return () => {
      cancelled = true;
      observer.disconnect();
      text.style.fontSize = '';
    };
  }, [children, fitOneLine]);

  return (
    <span ref={fitOneLine ? labelRef : undefined} className={`shiny-name-label${className ? ` ${className}` : ''}`} style={{ '--name-color': displayNameColor ?? '#f5f4ef' } as CSSProperties}>
      <span className="shiny-name" data-tier={displayNameTierIndex ? '1' : '0'}>{children}</span>
    </span>
  );
}
