import { useMemo, useRef, useState } from 'react';
import { Award, ChevronDown, Coins, Crown, Flame, Heart, House, Rocket, Sparkles, Star, UserRound, X, Zap } from 'lucide-react';
import './_group.css';
import './Proposed.css';

type GiftItem = { id: string; name: string; cost: number };
const catalog: GiftItem[] = [
  { id: 'heart', name: 'Heart', cost: 50 },
  { id: 'spirit-pup', name: 'Spirit Pup', cost: 100 },
  { id: 'moonfox', name: 'Moonfox', cost: 500 },
  { id: 'cosmic-encore', name: 'Cosmic Encore', cost: 2500 },
  { id: 'fireworks', name: 'Fireworks', cost: 2500 },
  { id: 'rose-shower', name: 'Rose Shower', cost: 2500 },
  { id: 'whip', name: 'Whip', cost: 2500 },
];
const seats = [
  { username: 'alex-m', name: 'Alex', initials: 'AM', host: true, tone: 'plum' },
  { username: 'maya-r', name: 'Maya', initials: 'MR', tone: 'rose' },
  { username: 'theo-k', name: 'Theo', initials: 'TK', tone: 'blue' },
  { username: 'jules-a', name: 'Jules', initials: 'JA', tone: 'gold' },
];
const categories = [
  { id: 'popular', label: 'Popular', Icon: Flame, gifts: catalog },
  { id: 'special', label: 'Special', Icon: Sparkles, gifts: catalog.filter(g => ['cosmic-encore', 'fireworks', 'rose-shower', 'whip'].includes(g.id)) },
  { id: 'room', label: 'Room', Icon: House, gifts: catalog },
];
const giftGlyphs = [Heart, Sparkles, Crown, Rocket, Star, Award, Flame, Zap];
function GiftArt({ gift, size = 43 }: { gift: GiftItem; size?: number }) {
  const index = catalog.findIndex(item => item.id === gift.id);
  const Icon = giftGlyphs[index % giftGlyphs.length];
  return <span className={`stgp-art stgp-art-${index % 5}`}><Icon size={size} strokeWidth={1.65} aria-hidden /></span>;
}

export function Proposed() {
  const [selectedRecipient, setSelectedRecipient] = useState('all');
  const [categoryId, setCategoryId] = useState('popular');
  const [selectedGift, setSelectedGift] = useState('heart');
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [balance, setBalance] = useState(7800);
  const scroller = useRef<HTMLDivElement>(null);
  const activeCategory = categories.find(category => category.id === categoryId) ?? categories[0];
  const pages = useMemo(() => Array.from({ length: Math.ceil(activeCategory.gifts.length / 6) }, (_, index) =>
    activeCategory.gifts.slice(index * 6, index * 6 + 6)), [activeCategory]);
  const [page, setPage] = useState(0);
  const gift = catalog.find(item => item.id === selectedGift) ?? catalog[0];
  const recipient = seats.find(person => person.username === selectedRecipient);
  const total = gift.cost * quantity * (selectedRecipient === 'all' ? seats.length : 1);
  const enough = balance >= total;
  const selectCategory = (id: string) => {
    setCategoryId(id);
    setPage(0);
    setNotice('');
    if (scroller.current) scroller.current.scrollLeft = 0;
  };
  const selectGift = (item: GiftItem) => { setSelectedGift(item.id); setNotice(''); };
  const send = () => {
    if (!enough) { setNotice('Not enough coins for this send.'); return; }
    setBalance(value => value - total);
    setNotice(`Sent ${quantity} ${gift.name}${quantity > 1 ? 's' : ''} ${selectedRecipient === 'all' ? 'to everyone in the room' : `to ${recipient?.name}`}.`);
  };

  return <main className="stgp-stage">
    <div className="stgp-stream" aria-label="Live Streamtalk room">
      <header className="stgp-stream-header"><span className="stgp-brand"><i>S</i> STREAMTALK</span><span className="stgp-live"><b /> LIVE · 04</span></header>
      <div className="stgp-video-copy"><span>STREAMTALK / CAMPUS LOUNGE</span><strong>Friday night<br />hangout</strong><small>4 people here · room is live</small><div className="stgp-eq"><i /><i /><i /><i /><i /><i /><i /></div></div>
      <div className="stgp-room-chat"><p><b>Maya</b> this song is such a vibe</p><p><b>Theo</b> staying up for one more</p><p><b>Alex</b> welcome in, everyone</p></div>
    </div>
    <div className="stgp-scrim" />
    <section className="stgp-sheet" role="dialog" aria-modal="true" aria-label="Send a gift">
      <div className="stgp-handle"><span /></div>
      <header className="stgp-heading">
        <div><h1>Send a gift <Sparkles size={15} /></h1><p>Make this moment a little brighter</p></div>
        <button className="stgp-icon-button" aria-label="Close gift panel" onClick={() => setNotice('Gift panel stays open in this preview.')}><X size={18} /></button>
      </header>
      <div className="stgp-people-row">
        <button className={`stgp-all${selectedRecipient === 'all' ? ' active' : ''}`} aria-pressed={selectedRecipient === 'all'} onClick={() => { setSelectedRecipient('all'); setNotice(''); }}>ALL</button>
        <div className="stgp-seats" role="list" aria-label="Room seat members">
          {seats.map(person => <button key={person.username} role="listitem" className={`stgp-person ${selectedRecipient === person.username ? 'active' : ''}`} onClick={() => { setSelectedRecipient(person.username); setNotice(''); }} aria-pressed={selectedRecipient === person.username} aria-label={`Gift to ${person.name}${person.host ? ', host' : ''}`}>
            <span className={`stgp-avatar ${person.tone}`}>{person.initials}{person.host && <i><House size={10} /></i>}</span><span>{person.name}</span>
          </button>)}
        </div>
        <button className={`stgp-profile${profileOpen ? ' active' : ''}`} aria-label="Open selected recipient profile card" onClick={() => setProfileOpen(value => !value)}><UserRound size={17} /></button>
      </div>
      {profileOpen && <div className="stgp-profile-card"><span className={`stgp-avatar ${recipient?.tone ?? 'plum'}`}>{recipient?.initials ?? '04'}</span><span><b>{recipient?.name ?? 'Room members'}</b><small>{recipient ? (recipient.host ? 'Room host · online now' : 'In this room · online now') : 'Gift selected for everyone'}</small></span><button onClick={() => setProfileOpen(false)} aria-label="Close profile card"><X size={14} /></button></div>}
      <div className="stgp-level"><div className="stgp-level-mark"><Award size={16} /></div><div className="stgp-level-meta"><div><b>Lv. 18</b><span>Room supporter</span><em>PREVIEW DATA</em></div><strong>2,460 <small>/ 3,000 XP</small></strong><div className="stgp-progress"><i /></div></div><span className="stgp-level-next">+540<br /><small>to Lv. 19</small></span></div>
      <nav className="stgp-tabs" aria-label="Gift categories">{categories.map(({ id, label, Icon }) => <button key={id} className={categoryId === id ? 'active' : ''} aria-pressed={categoryId === id} onClick={() => selectCategory(id)}><Icon size={14} />{label}</button>)}</nav>
      <div className="stgp-catalog-scroll">
        <div className="stgp-feature" onClick={() => selectGift(activeCategory.gifts[0])} role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') selectGift(activeCategory.gifts[0]); }} aria-label={`Select featured ${activeCategory.gifts[0].name}`}>
          <div className="stgp-feature-art"><GiftArt gift={activeCategory.gifts[0]} size={51} /></div><div className="stgp-feature-text"><small>TONIGHT'S PICK · {activeCategory.label.toUpperCase()}</small><b>{activeCategory.gifts[0].name}</b><span>A little sparkle for the whole room</span></div><div className="stgp-feature-price"><Coins size={12} />{activeCategory.gifts[0].cost.toLocaleString()}</div>
        </div>
        <div className="stgp-pages" ref={scroller} onScroll={event => { const width = event.currentTarget.clientWidth; if (width) setPage(Math.round(event.currentTarget.scrollLeft / width)); }}>
          {pages.map((giftPage, pageIndex) => <div className="stgp-page" key={`${categoryId}-${pageIndex}`} aria-label={`Gift page ${pageIndex + 1}`}>
            <div className="stgp-grid">{giftPage.map(item => <button key={item.id} className={`stgp-card${selectedGift === item.id ? ' selected' : ''}`} aria-pressed={selectedGift === item.id} onClick={() => selectGift(item)}>
              <GiftArt gift={item} />{selectedGift === item.id && <span className="stgp-quantity-badge">×{quantity}</span>}
              <b>{item.name}</b><span className="stgp-price"><Coins size={11} />{item.cost.toLocaleString()}</span>
            </button>)}</div>
          </div>)}
        </div>
        {pages.length > 1 && <div className="stgp-dots" aria-label={`Page ${page + 1} of ${pages.length}`}>{pages.map((_, index) => <button key={index} className={page === index ? 'active' : ''} aria-label={`Go to page ${index + 1}`} onClick={() => scroller.current?.scrollTo({ left: index * (scroller.current?.clientWidth ?? 0), behavior: 'smooth' })} />)}</div>}
      </div>
      <footer className="stgp-footer">
        <div className="stgp-wallet"><div><span className="stgp-wallet-label">COIN BALANCE</span><b><Coins size={15} />{balance.toLocaleString()}</b></div><button className="stgp-recharge" onClick={() => setNotice('Recharge is not available in this preview.')}>Recharge <span>+</span></button><div className="stgp-points"><Star size={13} /> 2,460 <small>pts</small></div></div>
        <div className="stgp-send-row"><label className="stgp-quantity-select"><select aria-label="Gift quantity" value={quantity} onChange={event => setQuantity(Number(event.target.value))}>{[1, 10, 66, 99, 188, 520, 1314].map(value => <option value={value} key={value}>{value}</option>)}</select><ChevronDown size={14} /></label><button className="stgp-send" disabled={!enough} onClick={send}>{enough ? 'Send' : 'Need coins'} <span>{total.toLocaleString()} <Coins size={12} /></span></button></div>
        {notice && <div className="stgp-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message"><X size={13} /></button></div>}
      </footer>
    </section>
  </main>;
}
