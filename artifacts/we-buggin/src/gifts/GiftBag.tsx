import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Crown, Flame, Gift, House, Plus, ShoppingBag, Sparkles, UserRound, X, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { buyCoinsReturnState } from '@/social/buy-coins-navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useGetSocialMe, getGetSocialMeQueryKey, sendSocialGift, getGetRoomGiftEventsQueryKey } from '@workspace/api-client-react';
import { CoinAmount, refreshSocial, errMsg } from '@/social/common';
import { UserPhoto } from '@/components/user-photo';
import { ProfileTap } from '@/profile/QuickProfile';
import { GiftArtwork } from './GiftArtwork';
import { ownedGiftItems } from './gift-items';
import './gifts.css';
import './gift-panel.css';
import { isSpecialGift } from './gift-catalog-groups';

type Recipient = {
  username: string;
  displayName: string;
  displayNameColor?: string;
  displayNameTierIndex?: number;
  photoUrl?: string | null;
  isHost?: boolean;
} | null;

const QUICK_QUANTITIES = [1, 10, 66, 99];
const ALL_QUANTITIES = [1, 10, 66, 99, 188, 520, 1314];
function abbreviate(n: number) {
  if (n >= 1_000_000) return `${(Math.floor(n / 100_000) / 10).toString()}M`;
  if (n >= 1_000) return `${(Math.floor(n / 100) / 10).toFixed(1)}k`;
  return n.toLocaleString();
}

const FOCUSABLE = 'button:not([disabled]),[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

export function GiftBag({ recipient, recipients = [], roomId, sessionId, onClose }: {
  recipient?: Recipient;
  recipients?: Exclude<Recipient, null>[];
  roomId?: string;
  sessionId?: string;
  onClose: () => void;
}) {
  const me = useGetSocialMe({ query: {
    queryKey: getGetSocialMeQueryKey(),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    refetchInterval: 3000,
  } });
  const qc = useQueryClient();
  const [, nav] = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const retry = useRef<{
    signature: string;
    recipients: string[];
    keys: Map<string, string>;
    completed: Set<string>;
  } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [recipientSelection, setRecipientSelection] = useState<{ mode: 'all' } | { mode: 'one'; username: string }>(
    () => recipient?.username ? { mode: 'one', username: recipient.username } : { mode: 'all' },
  );
  const [activeCategoryId, setActiveCategoryId] = useState('popular');
  const [clockNow, setClockNow] = useState(() => Date.now());
  const catalogScroller = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const quantityId = useId();
  const recipientKey = recipients.map(person => person.username.toLowerCase()).join('|');
  const items = useMemo(() => (me.data ? ownedGiftItems(me.data, clockNow) : []), [clockNow, me.data]);
  useEffect(() => {
    if (!items.length) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [items.length]);
  const remainingTime = (expiresAt: string | null) => {
    if (!expiresAt) return 'No expiry';
    const minutes = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - clockNow) / 60_000));
    if (!minutes) return 'Expired · refreshing bag';
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return days ? `Expires in ${days}d ${hours}h` : hours ? `Expires in ${hours}h ${minutes % 60}m` : `Expires in ${minutes}m`;
  };
  const catalog = useMemo(
    () => roomId ? me.data?.gifts ?? [] : [],
    [me.data?.gifts, roomId],
  );
  const categories = useMemo(() => {
    const specialGifts = catalog.filter(isSpecialGift);
    const vipGifts = catalog.filter(g => /vip/i.test(`${g.id} ${g.name}`));
    const bagItems = items.map(item => {
      const gift = me.data?.gifts.find(candidate => candidate.id === item.id);
      return gift ?? { id: item.id, name: item.name, cost: 0, iconUrl: null };
    });
    const result: { id: string; label: string; Icon: LucideIcon; gifts: Array<{ id: string; name: string; cost: number; iconUrl?: string | null }> }[] = [
      { id: 'my-bag', label: 'My Bag', Icon: ShoppingBag, gifts: bagItems },
      { id: 'popular', label: 'Popular', Icon: Flame, gifts: catalog },
      ...(specialGifts.length ? [{ id: 'special', label: 'Special', Icon: Sparkles, gifts: specialGifts }] : []),
      ...(catalog.length > specialGifts.length ? [{ id: 'room', label: 'Room', Icon: House, gifts: catalog.filter(g => !isSpecialGift(g)) }] : []),
      ...(vipGifts.length ? [{ id: 'vip', label: 'VIP', Icon: Crown, gifts: vipGifts }] : []),
    ];
    return result;
  }, [catalog, items, me.data?.gifts]);
  const activeCategory = categories.find(category => category.id === activeCategoryId) ?? categories[0] ?? null;
  const selected = catalog.find(i => i.id === sel) ?? items.find((i) => i.id === sel) ?? null;
  const price = me.data?.gifts.find(g => g.id === sel)?.cost ?? 0;
  const selectedRecipient = recipientSelection.mode === 'one'
    ? recipients.find(person => person.username.toLowerCase() === recipientSelection.username.toLowerCase()) ?? null
    : null;
  const selectedRecipients = recipientSelection.mode === 'all'
    ? recipients
    : selectedRecipient ? [selectedRecipient] : [];
  const profileRecipient = selectedRecipient
    ?? recipients.find(person => person.isHost)
    ?? recipients[0]
    ?? null;
  const canSend = selectedRecipients.length > 0 && !!roomId && !!sessionId && !!sel
    && catalog.some(gift => gift.id === sel);
  const unlimited = me.data?.wallet.unlimited === true;
  const heldQuantity = sel ? items.find(item => item.id === sel)?.quantity ?? 0 : 0;
  const totalCost = price * Math.max(0, quantity * selectedRecipients.length - heldQuantity);
  const bagOnly = activeCategoryId === 'my-bag';
  const enoughStored = !bagOnly || heldQuantity >= quantity * selectedRecipients.length;
  const enough = enoughStored && (unlimited || (me.data?.wallet.balance ?? 0) >= totalCost);

  useEffect(() => {
    if (!sel || catalog.some(gift => gift.id === sel)) return;
    retry.current = null;
    setSel(null);
    setNotice(null);
    setError("This gift isn't available right now. The gift list has been refreshed.");
  }, [catalog, sel]);

  useEffect(() => {
    if (recipientSelection.mode === 'one' && !recipients.some(person =>
      person.username.toLowerCase() === recipientSelection.username.toLowerCase())) {
      setRecipientSelection({ mode: 'all' });
      setNotice('That person is no longer in a seat. Choose someone else or use ALL.');
    }
  }, [recipientKey, recipientSelection]);

  useEffect(() => {
    if (!categories.some(category => category.id === activeCategoryId)) {
      setActiveCategoryId(categories[0]?.id ?? 'popular');
    }
    if (catalogScroller.current) catalogScroller.current.scrollTop = 0;
  }, [activeCategoryId, categories]);

  function chooseGift(giftId: string) {
    setSel(giftId);
    setError(null);
    setNotice(null);
    retry.current = null;
  }

  function chooseQuantity(value: number) {
    setQuantity(value);
    setError(null);
    setNotice(null);
    retry.current = null;
  }

  async function send() {
    if (!canSend || busy || !enough || !sel || !roomId || !sessionId) return;
    const contextId = roomId;
    const targetUsernames = selectedRecipients.map(person => person.username);
    const recipientIntent = recipientSelection.mode === 'all'
      ? 'all'
      : `one:${recipientSelection.username.toLowerCase()}`;
    const signature = JSON.stringify([contextId, sel, quantity, recipientIntent, bagOnly]);
    if (!retry.current || retry.current.signature !== signature) {
      retry.current = {
        signature,
        recipients: targetUsernames,
        keys: new Map(targetUsernames.map(username => [username.toLowerCase(), crypto.randomUUID()])),
        completed: new Set(),
      };
    } else {
      retry.current.recipients = targetUsernames;
      for (const username of targetUsernames) {
        const normalized = username.toLowerCase();
        if (!retry.current.keys.has(normalized)) retry.current.keys.set(normalized, crypto.randomUUID());
      }
    }
    const attempt = retry.current;
    setBusy(true); setError(null); setNotice(null);
    setBatchProgress({ done: attempt.completed.size, total: attempt.recipients.length });
    try {
      for (const username of attempt.recipients) {
        const normalized = username.toLowerCase();
        if (attempt.completed.has(normalized)) continue;
        await sendSocialGift({
          testMode: unlimited,
          recipient: username,
          giftId: sel,
          quantity,
          ...(bagOnly ? { useGiftBagOnly: true } : {}),
          roomId,
          idempotencyKey: attempt.keys.get(normalized)!,
        }, { headers: { 'X-Room-Session': sessionId } });
        attempt.completed.add(normalized);
        setBatchProgress({ done: attempt.completed.size, total: attempt.recipients.length });
      }
      refreshSocial(qc);
      if (roomId) void qc.invalidateQueries({ queryKey: getGetRoomGiftEventsQueryKey(roomId) });
      retry.current = null;
      closeRef.current();
    } catch (e) {
      refreshSocial(qc);
      if (roomId) void qc.invalidateQueries({ queryKey: getGetRoomGiftEventsQueryKey(roomId) });
      const message = errMsg(e);
      if (message.includes("This gift isn't available right now.")) {
        void me.refetch();
        setError("This gift isn't available right now. The gift list is refreshing.");
      } else {
        setError(`${attempt.completed.size} of ${attempt.recipients.length} recipients sent. ${message}`);
      }
    } finally {
      setBusy(false);
      setBatchProgress(null);
    }
  }

  useEffect(() => {
    const prev = opener.current as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => { if (prev && document.contains(prev)) prev.focus(); };
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
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
    <div className="gift-framework-backdrop gift-panel-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="gift-bag-backdrop">
      <div ref={ref} className="gift-framework gift-sheet gift-room-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKey} data-testid="gift-bag">
        <div className="gift-panel-handle" aria-hidden="true"><span /></div>
        <header className="gift-panel-heading">
          <h2 id={titleId} data-testid="gift-bag-title">{unlimited ? 'Send a test gift' : 'Send a gift'}</h2>
          {me.data && <Link href="/community/coins" state={buyCoinsReturnState()} className="gift-panel-balance-pill"
            aria-label={`Balance ${unlimited ? 'unlimited' : me.data.wallet.balance.toLocaleString()} coins. Buy coins`} data-testid="gift-bag-balance">
            <span className="gift-panel-coin" aria-hidden />
            <span>{unlimited ? 'Unlimited test' : abbreviate(me.data.wallet.balance)}</span>
            <Plus size={13} strokeWidth={3} aria-hidden />
          </Link>}
          <button type="button" className="gift-panel-icon-button" onClick={onClose} aria-label="Close gift panel" data-testid="gift-bag-close"><X size={18} aria-hidden /></button>
        </header>

        {roomId && <div className="gift-panel-recipients" aria-label="Gift recipients">
          <button type="button" className={`gift-panel-all${recipientSelection.mode === 'all' ? ' is-selected' : ''}`}
            aria-pressed={recipientSelection.mode === 'all'} disabled={busy}
            onClick={() => { setRecipientSelection({ mode: 'all' }); setError(null); setNotice(null); retry.current = null; }}>
            ALL
          </button>
          <div className="gift-panel-people" role="list" aria-label="People in room seats">
            {recipients.map(person => {
              const isSelected = recipientSelection.mode === 'one'
                && recipientSelection.username.toLowerCase() === person.username.toLowerCase();
              return <div key={person.username} role="listitem"
                className={`gift-panel-person${isSelected ? ' is-selected' : ''}${person.isHost ? ' is-host' : ''}`}
                title={`${person.displayName || person.username}${person.isHost ? ' · Host' : ''}`}>
                <span className="gift-panel-avatar">
                  <ProfileTap username={person.username} label={`Open profile for ${person.displayName || person.username}`}>
                    <UserPhoto username={person.username} displayName={person.displayName} photoUrl={person.photoUrl} size={44} />
                  </ProfileTap>
                  {person.isHost && <span className="gift-panel-host-mark" aria-label="Host"><House size={12} aria-hidden /></span>}
                </span>
                <button type="button" className="gift-panel-person-name gift-panel-person-select"
                  aria-pressed={isSelected} disabled={busy} aria-label={`Gift to ${person.displayName || person.username}${person.isHost ? ', host' : ''}`}
                  data-testid={`button-gift-recipient-${person.username}`}
                  onClick={() => { setRecipientSelection({ mode: 'one', username: person.username }); setError(null); setNotice(null); retry.current = null; }}>
                  {person.displayName || person.username}
                </button>
              </div>;
            })}
            {!recipients.length && <span className="gift-panel-no-people">No one is seated yet</span>}
          </div>
          <button type="button" className="gift-panel-profile-button" disabled={!profileRecipient}
            aria-label={profileRecipient ? `Open ${profileRecipient.displayName || profileRecipient.username}'s profile` : 'No recipient profile available'}
            onClick={() => {
              if (!profileRecipient) return;
              onClose();
              nav(`/community/people/${encodeURIComponent(profileRecipient.username)}`);
            }}>
            <UserRound size={18} aria-hidden />
          </button>
        </div>}

        {categories.length > 0 && <nav className="gift-panel-categories" aria-label="Gift categories">
          {categories.map(({ id, label, Icon }) => <button key={id} type="button"
            className={`gift-panel-category${activeCategory?.id === id ? ' is-active' : ''}`}
            aria-pressed={activeCategory?.id === id} disabled={busy}
            onClick={() => { setActiveCategoryId(id); setError(null); setNotice(null); }}>
            <Icon size={15} strokeWidth={2.7} aria-hidden />{label}
          </button>)}
        </nav>}

        <div className="gift-panel-scroll" ref={catalogScroller}>
          {me.isLoading ? (
            <div role="status" aria-label="Loading gift catalog" className="gift-panel-skeletons">
              <div /><div /><div />
            </div>
          ) : me.isError || !me.data ? (
            <div role="alert" className="gift-panel-load-error">
              <p>Your gift catalog could not be loaded.</p>
              <button type="button" className="gift-panel-secondary" onClick={() => me.refetch()} data-testid="gift-bag-retry">Retry</button>
            </div>
          ) : activeCategory?.id === 'my-bag' ? (
            items.length > 0 ? (
              <div className="gift-panel-grid gift-panel-owned" data-testid="gift-bag-list">
                {items.map(gift => {
                  const lots = me.data?.giftBagLots?.filter(lot =>
                    lot.giftId === gift.id && (!lot.expiresAt || Date.parse(lot.expiresAt) > clockNow)) ?? [];
                  return <button key={gift.id} type="button"
                    className={`gift-panel-card gift-panel-owned-card${sel === gift.id ? ' is-selected' : ''}`}
                    aria-pressed={sel === gift.id} disabled={busy || !catalog.some(item => item.id === gift.id)} data-testid={`gift-bag-item-${gift.id}`}
                    onClick={() => chooseGift(gift.id)}>
                    <span className="gift-panel-card-art"><GiftArtwork gift={gift} size={48} /></span>
                    <span className="gift-panel-card-name">{gift.name}</span>
                    <span className="gift-panel-owned-count">In bag · {gift.quantity ?? 0}</span>
                    <span className="gift-panel-owned-expiry">
                      {lots.length ? lots.map((lot, index) =>
                        <span key={`${gift.id}-${index}`}>{lot.quantity} · {remainingTime(lot.expiresAt)}</span>)
                        : <span>{gift.quantity ?? 0} · No expiry</span>}
                    </span>
                    {!catalog.some(item => item.id === gift.id) && <span className="gift-panel-owned-expiry">This gift is not currently available to send.</span>}
                    <span className="gift-panel-owned-value">Held gift</span>
                  </button>;
                })}
              </div>
            ) : (
              <div className="gift-panel-empty" data-testid="gift-bag-empty">
                <ShoppingBag size={26} aria-hidden />
                <p>Your bag is empty. Buy a gift in the Store to hold it here.</p>
              </div>
            )
          ) : !catalog.length ? (
            <div className="gift-panel-empty">
              <Gift size={26} aria-hidden />
              <p>No gifts are available in this room right now.</p>
            </div>
          ) : activeCategory && activeCategory.gifts.length > 0 ? (
            <>
              <div className="gift-panel-catalog"
                aria-label={`${activeCategory.label} gifts`}>
                <div className="gift-panel-grid" role="list" aria-label={`${activeCategory.label} gifts`}>
                  {activeCategory.gifts.map(gift => <button key={gift.id} type="button" role="listitem"
                    className={`gift-panel-card${sel === gift.id ? ' is-selected' : ''}`}
                    aria-pressed={sel === gift.id} disabled={busy} data-testid={`gift-catalog-${gift.id}`}
                    onClick={() => chooseGift(gift.id)}>
                    <span className="gift-panel-card-art"><GiftArtwork gift={gift} size={44} />
                      {sel === gift.id && quantity > 1 && <span className="gift-panel-card-quantity">×{quantity}</span>}
                    </span>
                    <span className="gift-panel-card-name">{gift.name}</span>
                    <CoinAmount>{gift.cost.toLocaleString()}</CoinAmount>
                  </button>)}
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="gift-panel-send-zone">
          {selected && selectedRecipients.length > 0 && <p className="gift-panel-total">
            {selectedRecipients.length > 1 ? `${selectedRecipients.length} recipients · ` : ''}{quantity} × {selected.name}
            {heldQuantity > 0 && ` · ${Math.min(heldQuantity, quantity * selectedRecipients.length)} from My Bag`}
            {' · '}<CoinAmount>{totalCost.toLocaleString()} coins to charge</CoinAmount>
          </p>}
          {error && <p role="alert" className="gift-panel-message is-error">{error}</p>}
          {notice && <p role="status" className="gift-panel-message is-success">{notice}</p>}
          {canSend && !enough && <p className="gift-panel-message is-error">Not enough coins. <Link href="/community/coins" state={buyCoinsReturnState()}>Recharge &gt;</Link></p>}
          {me.data && <footer className="gift-panel-footer">
            <span className="gift-panel-wallet-balance gift-panel-sr" data-testid="gift-bag-wallet"><CoinAmount>{unlimited ? 'Unlimited' : me.data.wallet.balance.toLocaleString()}</CoinAmount></span>
            <div className="gift-panel-send-controls">
              <div className="gift-panel-qty-pills" role="group" aria-label="Gift quantity">
                {QUICK_QUANTITIES.map(value => <button key={value} type="button" className={`gift-panel-qty${quantity === value ? ' is-selected' : ''}`}
                  aria-pressed={quantity === value} disabled={busy} onClick={() => chooseQuantity(value)} data-testid={`button-gift-quantity-${value}`}>
                  x{value}
                </button>)}
                <label className={`gift-panel-quantity${QUICK_QUANTITIES.includes(quantity) ? '' : ' is-selected'}`} htmlFor={quantityId}>
                  <select id={quantityId} value={quantity} onChange={event => chooseQuantity(Number(event.target.value))} aria-label="More gift quantities" disabled={busy} data-testid="select-gift-quantity">
                    {ALL_QUANTITIES.map(value => <option key={value} value={value}>{`x${value}`}</option>)}
                  </select>
                  <span aria-hidden>{QUICK_QUANTITIES.includes(quantity) ? 'More' : `x${quantity}`}</span>
                  <ChevronDown size={12} aria-hidden />
                </label>
              </div>
              <button type="button" className="gift-panel-send" disabled={busy || !canSend || !enough}
                onClick={send} data-testid="gift-bag-send">
                {busy ? batchProgress ? `${batchProgress.done}/${batchProgress.total}` : 'Sending…' : 'Send'}
              </button>
            </div>
          </footer>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
