import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useGetSocialMe, getGetSocialMeQueryKey, sendSocialGift, getGetRoomGiftEventsQueryKey } from '@workspace/api-client-react';
import { CoinAmount, GiftIcon, refreshSocial, errMsg } from '@/social/common';
import { RoomGiftIcon, cosmicEncoreMedia, type RoomGiftId } from './SpiritPup';
import { bigTierGiftMedia } from './BigTierGift';
import { ownedGiftItems } from './gift-items';
import { ShinyName } from '@/components/ShinyName';
import './gifts.css';

type Recipient = { username: string; displayName: string; displayNameColor?: string; displayNameTierIndex?: number } | null;

const FOCUSABLE = 'button:not([disabled]),[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
const ROOM_GIFT_IDS = new Set<RoomGiftId>([
  'heart', 'spirit-pup', 'moonfox', 'cosmic-encore', 'fireworks', 'rose-shower', 'whip',
]);
const isBuiltInRoomGiftId = (id: string): id is RoomGiftId => ROOM_GIFT_IDS.has(id as RoomGiftId);
const isMotionGiftId = (id: string) => /^motion-[0-9a-f-]{36}$/.test(id);
const isRoomGiftId = (id: string) => isBuiltInRoomGiftId(id) || isMotionGiftId(id);
function giftIcon(id: string) {
  return isBuiltInRoomGiftId(id) ? <RoomGiftIcon giftId={id} /> : <GiftIcon id={id} size={26} />;
}

export function GiftBag({ recipient, recipients = [], roomId, sessionId, streamId, onClose }: {
  recipient?: Recipient;
  recipients?: Exclude<Recipient, null>[];
  roomId?: string;
  sessionId?: string;
  streamId?: string;
  onClose: () => void;
}) {
  const me = useGetSocialMe({ query: { queryKey: getGetSocialMeQueryKey(), staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always', refetchInterval: 10000 } });
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = useRef<{ recipient: string; giftId: string; roomId: string; key: string } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [recipientUsername, setRecipientUsername] = useState(recipient?.username ?? '');
  const [recipientPickerOpen, setRecipientPickerOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const recipientListboxId = useId();
  useEffect(() => {
    if (!roomId && !streamId) return;
    const videos = [cosmicEncoreMedia.animation, ...Object.values(bigTierGiftMedia)].map(src => {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.src = src;
      video.load();
      return video;
    });
    const still = new Image();
    still.src = cosmicEncoreMedia.fallback;
    return () => {
      for (const video of videos) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [roomId, streamId]);
  const items = useMemo(() => (me.data ? ownedGiftItems(me.data) : []), [me.data]);
  const catalog = roomId || streamId ? me.data?.gifts.filter(g => isRoomGiftId(g.id)) ?? [] : [];
  const selected = catalog.find(i => i.id === sel) ?? items.find((i) => i.id === sel) ?? null;
  const price = me.data?.gifts.find(g => g.id === sel)?.cost ?? 0;
  const target = recipient ?? recipients.find(person => person.username === recipientUsername) ?? null;
  const canSend = !!target && (!!streamId || (!!roomId && !!sessionId)) && !!sel && isRoomGiftId(sel);
  const unlimited = me.data?.wallet.unlimited === true;
  const enough = unlimited || (me.data?.wallet.balance ?? 0) >= price;
  const name = target ? (target.displayName || target.username) : null;
  async function send() {
    if (!canSend || busy || !enough || !target || (!streamId && (!roomId || !sessionId))) return;
    const contextId = streamId ? `live:${streamId}` : roomId!;
    if (!retry.current || retry.current.recipient !== target.username || retry.current.giftId !== sel || retry.current.roomId !== contextId)
      retry.current = { recipient: target.username, giftId: sel!, roomId: contextId, key: crypto.randomUUID() };
    const attempt = retry.current;
    setBusy(true); setError(null);
    try {
      await sendSocialGift({
        recipient: attempt.recipient, giftId: attempt.giftId, ...(roomId ? { roomId } : {}),
        ...(streamId ? { streamId } : {}), idempotencyKey: attempt.key,
      }, roomId && sessionId ? { headers: { 'X-Room-Session': sessionId } } : undefined);
      refreshSocial(qc);
      if (roomId) void qc.invalidateQueries({ queryKey: getGetRoomGiftEventsQueryKey(roomId) });
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
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (recipientPickerOpen) { setRecipientPickerOpen(false); return; }
      closeRef.current();
      return;
    }
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
            <h2 className="gift-title" id={titleId} data-testid="gift-bag-title">{name
              ? <>Gift bag for <ShinyName displayNameColor={target?.displayNameColor} displayNameTierIndex={target?.displayNameTierIndex}>{name}</ShinyName></>
              : roomId || streamId ? 'Send a gift' : 'Your gift bag'}</h2>
            <p className="gift-sub">{name ? 'Choose a gift. Sending costs coins.' : roomId || streamId ? 'Choose someone here and a gift to send.' : 'Gifts you own.'}</p>
          </div>
          <button type="button" className="gift-btn" onClick={onClose} aria-label="Close gift bag" data-testid="gift-bag-close"><X size={16} aria-hidden /></button>
        </div>
        {me.data && <p className="gift-balance">Balance: <CoinAmount>{unlimited ? 'Unlimited test coins' : `${me.data.wallet.balance.toLocaleString()} coins`}</CoinAmount></p>}
        {(roomId || streamId) && !recipient && (
          <label className="gift-recipient">
            <span>Send to</span>
            <button type="button" className="gift-recipient-trigger" aria-label="Gift recipient"
              aria-haspopup="listbox" aria-expanded={recipientPickerOpen} aria-controls={recipientListboxId}
              data-testid="gift-recipient" disabled={recipients.length === 0}
              onClick={() => setRecipientPickerOpen(open => !open)}>
              {target
                ? <><ShinyName displayNameColor={target.displayNameColor} displayNameTierIndex={target.displayNameTierIndex}>{target.displayName || target.username}</ShinyName><span className="gift-recipient-handle">@{target.username}</span></>
                : <span className="gift-recipient-placeholder">{recipients.length
                  ? streamId ? 'Choose someone in this live stream' : 'Choose someone in this university'
                  : streamId ? 'No one else is watching yet' : 'No other people are here yet'}</span>}
              <span aria-hidden="true">{recipientPickerOpen ? '▲' : '▼'}</span>
            </button>
            {recipientPickerOpen && recipients.length > 0 && (
              <div id={recipientListboxId} className="gift-recipient-options" role="listbox" aria-label="People to gift">
                {recipients.map(person => <button key={person.username} type="button" role="option"
                  aria-selected={person.username === target?.username}
                  onClick={() => {
                    setRecipientUsername(person.username);
                    setRecipientPickerOpen(false);
                    setError(null);
                    retry.current = null;
                  }}>
                  <ShinyName displayNameColor={person.displayNameColor} displayNameTierIndex={person.displayNameTierIndex}>
                    {person.displayName || person.username}
                  </ShinyName>
                  <span className="gift-recipient-handle">@{person.username}</span>
                </button>)}
              </div>
            )}
          </label>
        )}
        {catalog.length > 0 && <section aria-label="Gift catalog">
          <h3 className="gift-catalog-heading">Gift catalog</h3>
          <ul className="gift-grid">{catalog.map(g => <li key={g.id}>
            <button type="button" className="gift-item" aria-pressed={sel === g.id} onClick={() => { setSel(g.id); setError(null); }} data-testid={`gift-catalog-${g.id}`}>
              {giftIcon(g.id)}<span>{g.name}</span><CoinAmount>{g.cost.toLocaleString()} coins</CoinAmount>
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
            Selected: {selected.name}{name ? <> for <ShinyName displayNameColor={target?.displayNameColor} displayNameTierIndex={target?.displayNameTierIndex}>{name}</ShinyName></> : ''}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {canSend && !enough && <p>Not enough coins. <Link href="/community/coins">Open coin store</Link></p>}
        {canSend ? <>
          <p>Send {selected?.name} to <ShinyName displayNameColor={target?.displayNameColor} displayNameTierIndex={target?.displayNameTierIndex}>{name}</ShinyName> for <CoinAmount>{price.toLocaleString()} coins</CoinAmount>. The recipient gets half; the house gets half. Your owned copies are collectibles.</p>
          <button type="button" className="gift-btn gift-send" disabled={busy || !enough} onClick={send} data-testid="gift-bag-send">{busy ? 'Sending…' : 'Send gift'}</button>
        </> : <>
          <button type="button" className="gift-btn gift-send" disabled data-testid="gift-bag-send">Send gift</button>
        </>}
      </div>
    </div>,
    document.body,
  );
}
