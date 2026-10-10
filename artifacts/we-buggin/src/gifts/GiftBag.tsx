import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Gift, X } from 'lucide-react';
import { useGetSocialMe, getGetSocialMeQueryKey } from '@workspace/api-client-react';
import { GiftIcon } from '@/social/common';
import { ownedGiftItems } from './gift-items';
import './gifts.css';

type Recipient = { username: string; displayName: string } | null;

const FOCUSABLE = 'button:not([disabled]),[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

export function GiftBag({ recipient, onClose }: { recipient?: Recipient; onClose: () => void }) {
  const me = useGetSocialMe({ query: { queryKey: getGetSocialMeQueryKey(), staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always' } });
  const [sel, setSel] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const items = useMemo(() => (me.data ? ownedGiftItems(me.data) : []), [me.data]);
  const selected = items.find((i) => i.id === sel) ?? null;
  const name = recipient ? (recipient.displayName || recipient.username) : null;

  useEffect(() => {
    const prev = opener.current as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => { if (prev && document.contains(prev)) prev.focus(); };
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
    if (e.key !== 'Tab' || !ref.current) return;
    const f = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!ref.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className="gift-framework-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="gift-bag-backdrop">
      <div ref={ref} className="gift-framework gift-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKey} data-testid="gift-bag">
        <div className="gift-head">
          <div>
            <h2 id={titleId} data-testid="gift-bag-title">{name ? `Gift bag for ${name}` : 'Your gift bag'}</h2>
            <p className="gift-sub">{name ? `Choose from the gifts you own.` : 'Gifts you own.'}</p>
          </div>
          <button type="button" className="gift-btn" onClick={onClose} aria-label="Close gift bag" data-testid="gift-bag-close"><X size={16} aria-hidden /></button>
        </div>
        {me.isLoading ? (
          <div role="status" aria-label="Loading gift bag" data-testid="gift-bag-loading" className="gift-grid">
            <div className="gift-skel" /><div className="gift-skel" /><div className="gift-skel" />
          </div>
        ) : me.isError || !me.data ? (
          <div role="alert" data-testid="gift-bag-error">
            <p>Your gift bag could not be loaded.</p>
            <button type="button" className="gift-btn" onClick={() => me.refetch()} data-testid="gift-bag-retry">Retry</button>
          </div>
        ) : items.length === 0 ? (
          <div data-testid="gift-bag-empty">
            <Gift size={28} aria-hidden />
            <p>Your gift bag is empty. You do not own any gifts yet.</p>
          </div>
        ) : (
          <ul className="gift-grid" data-testid="gift-bag-list">
            {items.map((g) => (
              <li key={g.id}>
                <button type="button" className="gift-item" aria-pressed={sel === g.id} onClick={() => setSel(g.id)} data-testid={`gift-item-${g.id}`}>
                  <GiftIcon id={g.id} size={26} /><span>{g.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <p role="status" data-testid="gift-bag-selection">
            Selected: {selected.name}{name ? ` for ${name}` : ''}
          </p>
        )}
        <p role="status">Gift sending is not yet available.</p>
        <button type="button" className="gift-btn gift-send" disabled aria-disabled="true" data-testid="gift-bag-send">Send gift (not available yet)</button>
      </div>
    </div>
  );
}
