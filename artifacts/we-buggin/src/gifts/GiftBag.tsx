import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useGetSocialMe, getGetSocialMeQueryKey, sendSocialGift, getGetRoomGiftEventsQueryKey } from '@workspace/api-client-react';
import { GiftIcon, refreshSocial, errMsg } from '@/social/common';
import { RoomGiftIcon, cosmicEncoreMedia, type RoomGiftId } from './SpiritPup';
import { ownedGiftItems } from './gift-items';
import './gifts.css';

type Recipient = { username: string; displayName: string } | null;

const FOCUSABLE = 'button:not([disabled]),[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
const ROOM_GIFT_IDS = new Set<RoomGiftId>(['heart', 'spirit-pup', 'moonfox', 'cosmic-encore']);
const isRoomGiftId = (id: string): id is RoomGiftId => ROOM_GIFT_IDS.has(id as RoomGiftId);
function giftIcon(id: string) {
  return isRoomGiftId(id) ? <RoomGiftIcon giftId={id} /> : <GiftIcon id={id} size={26} />;
}

export function GiftBag({ recipient, recipients = [], roomId, sessionId, onClose }: {
  recipient?: Recipient;
  recipients?: Exclude<Recipient, null>[];
  roomId?: string;
  sessionId?: string;
  onClose: () => void;
}) {
  const me = useGetSocialMe({ query: { queryKey: getGetSocialMeQueryKey(), staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always', refetchInterval: 10000 } });
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = useRef<{ recipient: string; giftId: string; roomId: string; key: string } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [recipientUsername, setRecipientUsername] = useState(recipient?.username ?? '');
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  useEffect(() => {
    if (!roomId) return;
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = cosmicEncoreMedia.animation;
    video.load();
    const still = new Image();
    still.src = cosmicEncoreMedia.fallback;
    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [roomId]);
  const items = useMemo(() => (me.data ? ownedGiftItems(me.data) : []), [me.data]);
  const catalog = roomId ? me.data?.gifts.filter(g => isRoomGiftId(g.id)) ?? [] : [];
  const selected = catalog.find(i => i.id === sel) ?? items.find((i) => i.id === sel) ?? null;
  const price = me.data?.gifts.find(g => g.id === sel)?.cost ?? 0;
  const target = recipient ?? recipients.find(person => person.username === recipientUsername) ?? null;
  const canSend = !!target && !!roomId && !!sessionId && !!sel && isRoomGiftId(sel);
  const enough = (me.data?.wallet.balance ?? 0) >= price;
  const name = target ? (target.displayName || target.username) : null;
  async function send() {
    if (!canSend || busy || !enough || !target || !roomId || !sessionId) return;
    if (!retry.current || retry.current.recipient !== target.username || retry.current.giftId !== sel || retry.current.roomId !== roomId)
      retry.current = { recipient: target.username, giftId: sel!, roomId, key: crypto.randomUUID() };
    const attempt = retry.current;
    setBusy(true); setError(null);
    try {
      await sendSocialGift({ recipient: attempt.recipient, giftId: attempt.giftId, roomId, idempotencyKey: attempt.key },
        { headers: { 'X-Room-Session': sessionId } });
      refreshSocial(qc);
      void qc.invalidateQueries({ queryKey: getGetRoomGiftEventsQueryKey(roomId) });
      retry.current = null;
      onClose();
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }

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

  return createPortal(
    <div className="gift-framework-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="gift-bag-backdrop">
      <div ref={ref} className="gift-framework gift-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKey} data-testid="gift-bag">
        <div className="gift-head">
          <div>
            <h2 id={titleId} data-testid="gift-bag-title">{name ? `Gift bag for ${name}` : roomId ? 'Send a gift' : 'Your gift bag'}</h2>
            <p className="gift-sub">{name ? 'Choose a gift. Sending costs credits.' : roomId ? 'Choose someone here and a gift to send.' : 'Gifts you own.'}</p>
          </div>
          <button type="button" className="gift-btn" onClick={onClose} aria-label="Close gift bag" data-testid="gift-bag-close"><X size={16} aria-hidden /></button>
        </div>
        {me.data && <p>Balance: {me.data.wallet.balance} credits</p>}
        {roomId && !recipient && (
          <label className="gift-recipient">
            <span>Send to</span>
            <select
              aria-label="Gift recipient"
              data-testid="gift-recipient"
              value={target?.username ?? ''}
              disabled={recipients.length === 0}
              onChange={e => { setRecipientUsername(e.target.value); setError(null); retry.current = null; }}
            >
              <option value="">{recipients.length ? 'Choose someone in this university' : 'No other people are here yet'}</option>
              {recipients.map(person => <option key={person.username} value={person.username}>
                {person.displayName} (@{person.username})
              </option>)}
            </select>
          </label>
        )}
        {catalog.length > 0 && <section aria-label="Gift catalog">
          <h3>Gift catalog</h3>
          <ul className="gift-grid">{catalog.map(g => <li key={g.id}>
            <button type="button" className="gift-item" aria-pressed={sel === g.id} onClick={() => { setSel(g.id); setError(null); }} data-testid={`gift-catalog-${g.id}`}>
              {giftIcon(g.id)}<span>{g.name}</span><span>{g.cost} credits</span>
            </button>
          </li>)}</ul>
        </section>}
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
          null
        ) : (
          <ul className="gift-grid" data-testid="gift-bag-list">
            {items.map((g) => (
              <li key={g.id}>
                <button type="button" className="gift-item" aria-pressed={sel === g.id} onClick={() => setSel(g.id)} data-testid={`gift-item-${g.id}`}>
                  {giftIcon(g.id)}<span>{g.name}</span>
                  {g.quantity && <span>Owned: {g.quantity}</span>}
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
        {error && <p role="alert">{error}</p>}
        {canSend && !enough && <p>Not enough credits. <Link href="/community/credits">Open credit store</Link></p>}
        {canSend ? <>
          <p>Send {selected?.name} to {name} for {price} credits. The recipient gets half; the house gets half. Your owned copies are collectibles.</p>
          <button type="button" className="gift-btn gift-send" disabled={busy || !enough} onClick={send} data-testid="gift-bag-send">{busy ? 'Sending…' : 'Send gift'}</button>
        </> : <>
          <button type="button" className="gift-btn gift-send" disabled data-testid="gift-bag-send">Send gift</button>
        </>}
      </div>
    </div>,
    document.body,
  );
}
