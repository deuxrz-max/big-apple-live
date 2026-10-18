import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Coins, X, Award, Crown, Flame, Gem, Gift, Heart, Rocket, Sparkles, Star, Zap, type LucideIcon } from 'lucide-react';
import './_group.css';

type Recipient = { username: string; displayName: string; displayNameColor?: string; displayNameTierIndex?: number } | null;
type RoomGiftId = 'heart' | 'spirit-pup' | 'moonfox' | 'cosmic-encore' | 'fireworks' | 'rose-shower' | 'whip';
type Gift = { id: string; name: string; cost: number };
type GiftBagData = {
  wallet: { balance: number; unlimited: boolean };
  inventory: string[];
  gifts: Gift[];
  products: { id: string }[];
  giftQuantities: Record<string, number>;
};

const FOCUSABLE = 'button:not([disabled]),[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
const ROOM_GIFT_IDS = new Set<RoomGiftId>([
  'heart', 'spirit-pup', 'moonfox', 'cosmic-encore', 'fireworks', 'rose-shower', 'whip',
]);
const isBuiltInRoomGiftId = (id: string): id is RoomGiftId => ROOM_GIFT_IDS.has(id as RoomGiftId);
const isRoomGiftId = (id: string) => isBuiltInRoomGiftId(id);

const ICONS: LucideIcon[] = [Star, Award, Crown, Gem, Heart, Sparkles, Flame, Rocket, Zap];
function iconFor(id: string): LucideIcon {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return ICONS[hash % ICONS.length];
}
function GiftIcon({ id, size = 22 }: { id: string; size?: number }) {
  const Icon = id.toLowerCase().includes('coin') ? Coins : iconFor(id + 'g') ?? Gift;
  return <Icon size={size} aria-hidden />;
}
function giftIcon(id: string) {
  // RoomGiftIcon's original fallback is the shared, deterministic GiftIcon.
  return <GiftIcon id={id} size={26} />;
}
function CoinAmount({ children, size = 14 }: { children: ReactNode; size?: number }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
    <Coins size={size} aria-hidden="true" style={{ color: '#f5cb8d', flex: '0 0 auto' }} />
    {children}
  </span>;
}
function ShinyName({ children, displayNameColor, displayNameTierIndex = 0 }: {
  children: ReactNode; displayNameColor?: string | null; displayNameTierIndex?: number | null;
}) {
  const tier = Number.isFinite(displayNameTierIndex)
    ? Math.max(0, Math.min(18, Math.floor(displayNameTierIndex ?? 0)))
    : 0;
  const style = tier > 0 && displayNameColor
    ? { '--shiny-name-color': displayNameColor } as CSSProperties
    : undefined;
  return <span className="shiny-name" data-tier={tier} style={style}>{children}</span>;
}

const recipients = [
  { username: 'maya-r', displayName: 'Maya Rivera', displayNameColor: '#ff9fbd', displayNameTierIndex: 3 },
  { username: 'theo-k', displayName: 'Theo Kim', displayNameColor: '#8dd8ff', displayNameTierIndex: 2 },
  { username: 'jules-a', displayName: 'Jules Avery' },
];
const owner = { username: 'alex-m', displayName: 'Alex Morgan', displayNameColor: '#c9a24a', displayNameTierIndex: 4 };

// Synthetic signed-in account and populated room catalog; no auth or API requests are used.
const MOCK_ME: GiftBagData = {
  wallet: { balance: 7800, unlimited: false },
  inventory: ['heart'],
  gifts: [
    { id: 'heart', name: 'Heart', cost: 50 },
    { id: 'spirit-pup', name: 'Spirit Pup', cost: 100 },
    { id: 'moonfox', name: 'Moonfox', cost: 500 },
    { id: 'cosmic-encore', name: 'Cosmic Encore', cost: 2500 },
    { id: 'fireworks', name: 'Fireworks', cost: 2500 },
    { id: 'rose-shower', name: 'Rose Shower', cost: 2500 },
    { id: 'whip', name: 'Whip', cost: 2500 },
  ],
  products: [],
  giftQuantities: { heart: 1 },
};

type OwnedGift = { id: string; name: string; quantity?: number };
function ownedGiftItems(data: GiftBagData): OwnedGift[] {
  const productIds = new Set(data.products.map((product) => product.id));
  const catalog = new Map(data.gifts.map((gift) => [gift.id, gift.name] as const));
  const seen = new Set<string>();
  const out: OwnedGift[] = [];
  for (const id of data.inventory) {
    if (seen.has(id) || productIds.has(id) || !catalog.has(id)) continue;
    seen.add(id);
    out.push({ id, name: catalog.get(id) as string, ...(data.giftQuantities[id] ? { quantity: data.giftQuantities[id] } : {}) });
  }
  return out;
}

function RoomBackdrop({ onOpen }: { onOpen: () => void }) {
  const people = [owner, ...recipients];
  return <main className="gift-room">
    <header className="gift-room-header">
      <div className="gift-room-brand"><span className="gift-room-mark">S</span><span>STREAMTALK</span></div>
      <span className="gift-room-live"><i /> LIVE ROOM</span>
    </header>
    <section className="gift-room-scene" aria-label="Live room">
      <div className="gift-room-screen">
        <span className="gift-room-screen-kicker">STREAMTALK / CAMPUS LOUNGE</span>
        <strong>Friday night<br />hangout</strong>
        <span className="gift-room-screen-sub">4 people here · room is live</span>
        <div className="gift-room-equalizer"><i /><i /><i /><i /><i /><i /><i /></div>
      </div>
      <div className="gift-room-seats" aria-label="Owner and three seated recipients">
        {people.map((person, index) => (
          <div className={`gift-room-person${index === 0 ? ' is-owner' : ''}`} key={person.username}>
            <span className={`gift-room-avatar gift-room-avatar-${index}`} aria-hidden="true">{person.displayName.split(' ').map(part => part[0]).join('')}</span>
            <strong>{person.displayName}</strong>
            <small>{index === 0 ? 'YOU · HOST' : 'SEATED'}</small>
          </div>
        ))}
      </div>
      <button className="gift-room-reopen" type="button" onClick={onOpen}><Gift size={16} /> Open gift bag</button>
    </section>
  </main>;
}

function GiftBag({ recipient, recipients = [], roomId, sessionId, streamId, onClose }: {
  recipient?: Recipient;
  recipients?: Exclude<Recipient, null>[];
  roomId?: string;
  sessionId?: string;
  streamId?: string;
  onClose: () => void;
}) {
  const me = { data: MOCK_ME, isLoading: false, isError: false, refetch: () => undefined };
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

  const items = useMemo(() => (me.data ? ownedGiftItems(me.data) : []), [me.data]);
  const catalog = roomId || streamId ? me.data?.gifts.filter(gift => isRoomGiftId(gift.id)) ?? [] : [];
  const selected = catalog.find(item => item.id === sel) ?? items.find(item => item.id === sel) ?? null;
  const price = me.data?.gifts.find(gift => gift.id === sel)?.cost ?? 0;
  const target = recipient ?? recipients.find(person => person.username === recipientUsername) ?? null;
  const canSend = !!target && (!!streamId || (!!roomId && !!sessionId)) && !!sel && isRoomGiftId(sel);
  const unlimited = me.data?.wallet.unlimited === true;
  const enough = unlimited || (me.data?.wallet.balance ?? 0) >= price;
  const name = target ? (target.displayName || target.username) : null;
  async function send() {
    if (!canSend || busy || !enough || !target || (!streamId && (!roomId || !sessionId))) return;
    const contextId = streamId ? `live:${streamId}` : roomId!;
    if (!retry.current || retry.current.recipient !== target.username || retry.current.giftId !== sel || retry.current.roomId !== contextId)
      retry.current = { recipient: target.username, giftId: sel!, roomId: contextId, key: 'local-mock-send' };
    setBusy(true);
    setError(null);
    try {
      // Local-only simulation of the send action; this baseline never calls an API.
      await Promise.resolve();
      retry.current = null;
      onClose();
    } catch {
      setError('The local gift simulation could not be completed.');
    } finally {
      setBusy(false);
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
          <ul className="gift-grid">{catalog.map(gift => <li key={gift.id}>
            <button type="button" className="gift-item" aria-pressed={sel === gift.id} onClick={() => { setSel(gift.id); setError(null); }} data-testid={`gift-catalog-${gift.id}`}>
              {giftIcon(gift.id)}<span>{gift.name}</span><CoinAmount>{gift.cost.toLocaleString()} coins</CoinAmount>
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
            {items.map(gift => (
              <li key={gift.id}>
                <button type="button" className="gift-item" aria-pressed={sel === gift.id} onClick={() => setSel(gift.id)} data-testid={`gift-item-${gift.id}`}>
                  {giftIcon(gift.id)}<span>{gift.name}</span>
                  {gift.quantity && <span>Owned: {gift.quantity}</span>}
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
        {canSend && !enough && <p>Not enough coins. <a href="#coin-store" onClick={event => event.preventDefault()}>Open coin store</a></p>}
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

export function Current() {
  const [bagOpen, setBagOpen] = useState(true);
  return <>
    <RoomBackdrop onOpen={() => setBagOpen(true)} />
    {bagOpen && <GiftBag recipients={recipients} roomId="mock-streamtalk-room" sessionId="mock-session" onClose={() => setBagOpen(false)} />}
  </>;
}
