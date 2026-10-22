import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { ChevronLeft, EllipsisVertical } from 'lucide-react';

/** Compact mobile app header: back affordance, centred title, trailing actions. */
export function ScreenHeader({ title, backHref, backLabel = 'Back', subtitle, actions, testId, className = '' }: {
  title: ReactNode;
  backHref?: string;
  backLabel?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <header className={`dw-screen-header ${className}`.trim()} data-testid={testId ?? 'header-screen'}>
      <div className="dw-screen-header-lead">
        {backHref && (
          <Link href={backHref} className="dw-icon-btn" aria-label={backLabel} data-testid="link-screen-back">
            <ChevronLeft size={22} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        )}
      </div>
      <div className="dw-screen-header-title">
        <h1>{title}</h1>
        {subtitle && <span className="dw-screen-header-sub">{subtitle}</span>}
      </div>
      <div className="dw-screen-header-trail">{actions}</div>
    </header>
  );
}

/** Overflow menu built on <details>; items are any buttons/links. Closes after a choice. */
export function ActionMenu({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const dismiss = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !ref.current) return;
      ref.current.open = false;
      ref.current.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <details ref={ref} className="dw-action-menu" data-testid={testId}
      onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="dw-icon-btn" aria-label={label} title={label}>
        <EllipsisVertical size={20} aria-hidden="true" />
      </summary>
      <div className="dw-action-menu-list"
        onClick={(e) => { if ((e.target as HTMLElement).closest('button,a')) e.currentTarget.closest('details')?.removeAttribute('open'); }}>
        {children}
      </div>
    </details>
  );
}
