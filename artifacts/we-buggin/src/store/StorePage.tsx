import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, BadgeCheck, Check, ChevronRight, Coins, Gift, LockKeyhole, Plus,
  Play, ShoppingBag, Sparkles, WandSparkles, X,
} from 'lucide-react';
import {
  getGetEntranceEffectShopQueryKey, getGetSocialMeQueryKey,
  useGetEntranceEffectShop, useGetSocialMe, usePurchaseEntranceEffect, usePurchaseSocialProduct,
  type SocialGiftCatalogId,
} from '@workspace/api-client-react';
import { BadgeArt } from '@/social/BadgeArt';
import { ErrorBox, Loading, Msg, errMsg } from '@/social/common';
import { giftStudioMediaUrl } from '@/gifts/GiftAnimationPlayer';
import { GiftArtwork } from '@/gifts/GiftArtwork';
import './store-page.css';

type StoreSection = 'badges' | 'effects' | 'gifts';
const PROMO_HEADLINE = 'THE DEUX WILD STORE IS OPEN.';
const SECTIONS: { id: StoreSection; label: string; icon: typeof Sparkles; deck: string }[] = [
  { id: 'badges', label: 'Badges', icon: BadgeCheck, deck: 'Status, earned over time' },
  { id: 'effects', label: 'Entrance effects', icon: WandSparkles, deck: 'Make an entrance' },
  { id: 'gifts', label: 'Gifts', icon: Gift, deck: 'Collectibles for your bag' },
];

function formatCredits(value: number) {
  return value.toLocaleString();
}

function requestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

function prefersSafariImage() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
    || (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent));
}

export function StorePage() {
  const queryClient = useQueryClient();
  const me = useGetSocialMe({
    query: {
      queryKey: getGetSocialMeQueryKey(),
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: 'always',
      refetchOnReconnect: 'always',
      refetchInterval: 15000,
    },
  });
  const shop = useGetEntranceEffectShop({
    query: {
      queryKey: getGetEntranceEffectShopQueryKey(),
      refetchOnMount: 'always',
      refetchOnWindowFocus: 'always',
    },
  });
  const purchase = usePurchaseEntranceEffect();
  const giftPurchase = usePurchaseSocialProduct();
  const [section, setSection] = useState<StoreSection>('badges');
  const [listing, setListing] = useState<StoreSection | null>(null);
  const [inventory, setInventory] = useState(false);
  const [selected, setSelected] = useState<{ type: StoreSection; id: string } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [fallbackPreviewId, setFallbackPreviewId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [notice, setNotice] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const sectionRefs = useRef<Record<StoreSection, HTMLElement | null>>({ badges: null, effects: null, gifts: null });

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(false), 3600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const selectByKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? SECTIONS.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : SECTIONS.length - 1)) % SECTIONS.length;
    setSection(SECTIONS[next].id);
    tabRefs.current[next]?.focus();
    sectionRefs.current[SECTIONS[next].id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const buyEffect = (effectId: SocialGiftCatalogId) => {
    setMessage(null);
    purchase.mutate({ effectId, data: { requestId: requestId() } }, {
      onSuccess: () => {
        setMessage({ ok: true, text: 'Entrance effect added to your collection.' });
        setSelected(null);
        void queryClient.invalidateQueries({ queryKey: getGetEntranceEffectShopQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetSocialMeQueryKey() });
      },
      onError: (error) => setMessage({ ok: false, text: errMsg(error) }),
    });
  };

  const buyGift = (giftId: string, name: string) => {
    setMessage(null);
    giftPurchase.mutate({ data: { itemId: giftId, idempotencyKey: requestId() } }, {
      onSuccess: () => {
        setMessage({ ok: true, text: `${name} was added to your gift collection. It does not send a gift or change past gift history.` });
        setSelected(null);
        void queryClient.invalidateQueries({ queryKey: getGetSocialMeQueryKey() });
      },
      onError: (error) => setMessage({ ok: false, text: errMsg(error) }),
    });
  };

  const wallet = me.data?.wallet;
  const products = me.data?.products ?? [];
  const gifts = me.data?.gifts ?? [];
  const effects = shop.data?.items ?? [];
  const ownedBadges = products.filter((product) => (me.data?.profile.badges ?? []).some((badge) => badge.id === product.id));
  const ownedEffects = effects.filter((effect) => effect.owned);
  const ownedGifts = gifts.filter((gift) => (me.data?.giftQuantities?.[gift.id] ?? 0) > 0);
  const modalEffect = selected?.type === 'effects' ? effects.find((item) => item.id === selected.id) : undefined;
  const modalGift = selected?.type === 'gifts' ? gifts.find((item) => item.id === selected.id) : undefined;
  const modalBadge = selected?.type === 'badges' ? products.find((item) => item.id === selected.id) : undefined;
  const scrollToSection = (id: StoreSection) => {
    setInventory(false);
    setListing(null);
    setSection(id);
    requestAnimationFrame(() => sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const art = (type: StoreSection, item: any, size = 'card') => {
    if (type === 'badges') return <div className={`st-art st-art-badge ${size}`}><BadgeArt id={item.id} name={item.name} imageUrl={item.badgeImage} size={size === 'large' ? 122 : 74} /></div>;
    if (type === 'effects') {
      const isPreviewing = previewId === item.id;
      return <div className={`st-art st-art-effect ${size}`}>
        {isPreviewing && item.media ? prefersSafariImage() || fallbackPreviewId === item.id
          ? <img className="st-effect-media" src={giftStudioMediaUrl(item.media.safariUrl)} alt={`${item.name} animated preview`} />
          : <video className="st-effect-media" src={giftStudioMediaUrl(item.media.webmUrl)} poster={giftStudioMediaUrl(item.media.safariUrl)} autoPlay muted playsInline controls aria-label={`${item.name} preview`} onError={() => setFallbackPreviewId(item.id)} />
          : item.media
            ? <video className="st-effect-thumbnail" poster={giftStudioMediaUrl(item.media.safariUrl)} preload="none" muted playsInline aria-hidden="true" />
            : <><WandSparkles size={size === 'large' ? 45 : 30} aria-hidden="true" /><span>ENTRANCE EFFECT</span></>}
        {(item.equipped || item.owned) && <span className="st-owned-ribbon">{item.equipped ? 'EQUIPPED' : 'OWNED'}</span>}
      </div>;
    }
    return <div className={`st-art st-art-gift ${size}`}>
      <GiftArtwork gift={item} size={size === 'large' ? 80 : 56} />
    </div>;
  };

  const openItem = (type: StoreSection, id: string) => {
    setSelected({ type, id });
    setPreviewId(null);
    setFallbackPreviewId(null);
    setMessage(null);
  };

  const renderCards = (type: StoreSection, items: any[], compact = false) => (
    <div className="st-item-grid" data-testid={`grid-store-${type}`}>
      {(compact ? items.slice(0, 4) : items).map((item, index) => {
        const owned = type === 'badges'
          ? (me.data?.profile.badges ?? []).some((badge) => badge.id === item.id)
          : type === 'effects' ? item.owned : (me.data?.giftQuantities?.[item.id] ?? 0) > 0;
        return <button type="button" className="st-item-card" key={item.id} onClick={() => openItem(type, item.id)} data-testid={`button-open-${type}-${item.id}`} aria-label={`View ${item.name}`}>
          <span className="st-card-art-wrap">{art(type, item)}{owned && <span className="st-card-owned"><Check size={12} /> {type === 'gifts' ? `IN BAG ${me.data?.giftQuantities?.[item.id] ?? ''}` : 'COLLECTED'}</span>}</span>
          <span className="st-card-copy"><strong>{item.name}</strong>
            {type === 'badges'
              ? <><span className="st-card-price"><Coins size={13} /> {formatCredits(item.cost)} <small>qualifying monthly spend</small></span><span className="st-card-earned">Auto-earned / not purchasable</span></>
              : <span><Coins size={13} /> {formatCredits(item.cost)} coins</span>}
          </span>
          <ChevronRight className="st-card-arrow" size={16} aria-hidden="true" />
          <span className="st-card-index">{String(index + 1).padStart(2, '0')}</span>
        </button>;
      })}
    </div>
  );

  const emptyState = (title: string, copy: string) => <div className="st-empty-state"><span><ShoppingBag size={24} /></span><strong>{title}</strong><p>{copy}</p></div>;

  const categoryContent = (type: StoreSection, full = false) => {
    const meta = SECTIONS.find((entry) => entry.id === type)!;
    const CategoryIcon = meta.icon;
    const items = type === 'badges' ? products : type === 'effects' ? effects : gifts;
    const queryLoading = type === 'effects' && shop.isLoading && !shop.data;
    const queryError = type === 'effects' && shop.isError && !shop.data;
    return <section className={`st-category-section st-category-${type}`} key={type} id={`section-store-${type}`} ref={(node) => { sectionRefs.current[type] = node; }} aria-labelledby={`heading-${type}`} data-testid={`section-store-${type}`}>
      <header className="st-category-heading">
        <div className="st-category-title">
          <span className="st-category-title-pill" id={`heading-${type}`}><CategoryIcon size={15} aria-hidden="true" />{meta.label}<small>{String(items.length).padStart(2, '0')}</small></span>
          <span className="st-overline">{meta.deck}</span>
        </div>
        {!full && <button type="button" className="st-category-more" onClick={() => { setListing(type); setInventory(false); }} data-testid={`button-more-${type}`}>
          <span>More Options</span><ChevronRight size={16} aria-hidden="true" />
        </button>}
      </header>
      {type === 'badges' && <div className="st-category-note"><LockKeyhole size={16} /><p>Badges are earned automatically from qualifying completed monthly coin purchases. They are never bought with wallet coins.</p></div>}
      {type === 'gifts' && <div className="st-category-note"><ShoppingBag size={16} /><p>Collect a copy for your bag. Buying here does not send a gift or change gift receipts or past history.</p></div>}
      {queryLoading && <div className="st-query-state"><Loading /></div>}
      {queryError && <ErrorBox error={shop.error} retry={() => shop.refetch()} />}
      {items.length === 0 && !queryLoading && !queryError
        ? emptyState(`No ${type === 'effects' ? 'effects' : type} available yet`, 'New collection pieces will appear here when they are ready.')
        : renderCards(type, items, !full)}
    </section>;
  };

  const closeOverlay = () => { setSelected(null); };

  return (
    <main className="st-store" data-testid="page-store">
      <div className="st-store-shell">
        <header className="st-header">
          <Link href="/user-portal" className="st-header-back" aria-label="Back to profile" data-testid="link-store-profile"><ArrowLeft size={20} /></Link>
          <h1>Store</h1>
          <button type="button" className={`st-header-items${inventory ? ' is-active' : ''}`} onClick={() => { setInventory(!inventory); setListing(null); setSelected(null); }} data-testid="button-my-items">
            <ShoppingBag size={16} /><span>My items</span>
          </button>
        </header>

        <section className="st-promo" data-testid="banner-store-promo" aria-label="Store announcement">
          <div className="st-promo-orbit st-promo-orbit-one" /><div className="st-promo-orbit st-promo-orbit-two" />
          <span className="st-promo-label"><Sparkles size={13} /> MEMBER SPOTLIGHT</span>
          <h2 data-testid="text-store-promo-headline">{PROMO_HEADLINE}</h2>
          <p>Find your signature in the Deux Wild collection.</p>
          <span className="st-promo-stamp">DW<br /><small>18+</small></span>
        </section>

        <nav className="st-launcher" aria-label="Browse store categories" role="tablist">
          {SECTIONS.map(({ id, label, icon: Icon, deck }, index) => <button
            key={id} type="button" role="tab" aria-selected={section === id} aria-controls={`section-store-${id}`}
            className={`st-launch-tile st-launch-${id}${section === id ? ' is-current' : ''}`}
            onClick={() => scrollToSection(id)} onKeyDown={(event) => selectByKeyboard(event, index)}
            ref={(node) => { tabRefs.current[index] = node; }} data-testid={`tab-store-${id}`}
          >
            <span className="st-launch-icon"><Icon size={25} strokeWidth={1.8} /></span><span className="st-launch-label">{label}</span><small>{deck}</small>
          </button>)}
        </nav>

        {me.isLoading && !me.data && <div className="st-loading-card"><Loading /></div>}
        {me.isError && !me.data && <div className="st-error-card"><ErrorBox error={me.error} retry={() => me.refetch()} /></div>}
        {me.data && <div className="st-store-content">
          {message && <div className="st-message" data-testid="status-store-message"><Msg ok={message.ok}>{message.text}</Msg></div>}
          {inventory ? <section className="st-inventory" data-testid="panel-store-inventory">
            <div className="st-view-heading"><span className="st-overline">YOUR COLLECTION</span><h2>My items</h2><p>Everything you have earned or collected, in one place.</p></div>
            {ownedBadges.length + ownedEffects.length + ownedGifts.length === 0
              ? emptyState('Your collection starts here', 'Earn a badge or add an effect or collectible to see it in your items.')
              : <>
                {ownedBadges.length > 0 && <section className="st-inventory-group"><h3><BadgeCheck size={18} /> Badges <small>{ownedBadges.length}</small></h3>{renderCards('badges', ownedBadges)}</section>}
                {ownedEffects.length > 0 && <section className="st-inventory-group"><h3><WandSparkles size={18} /> Entrance effects <small>{ownedEffects.length}</small></h3>{renderCards('effects', ownedEffects)}</section>}
                {ownedGifts.length > 0 && <section className="st-inventory-group"><h3><Gift size={18} /> Gifts in your bag <small>{ownedGifts.length}</small></h3>{renderCards('gifts', ownedGifts)}</section>}
              </>}
          </section> : listing ? <div className="st-listing-view">
            <button type="button" className="st-back-list" onClick={() => setListing(null)} data-testid="button-back-list"><ArrowLeft size={16} /> All collections</button>
            {categoryContent(listing, true)}
          </div> : <div className="st-category-previews">
            {categoryContent('badges')}
            {categoryContent('effects')}
            {categoryContent('gifts')}
          </div>}
        </div>}

        <footer className="st-store-footer"><span>DEUX WILD / MEMBER STORE</span><span>Made for your next entrance.</span></footer>
      </div>

      <aside className="st-balance-bar" aria-label="Wallet balance" data-testid="text-store-balance">
        <span className="st-balance-icon"><Coins size={18} /></span><span className="st-balance-label">COINS</span>
        <strong>{wallet ? (wallet.unlimited ? 'Unlimited test coins' : formatCredits(wallet.balance)) : '—'}</strong>
        <button type="button" onClick={() => setNotice(true)} aria-label="Add coins, coming soon" data-testid="button-store-add-credits"><Plus size={19} /></button>
      </aside>
      {notice && <div className="st-toast" role="status" aria-live="polite" data-testid="status-store-coming-soon">
        <span>Buying coins is coming soon.</span>
        <button type="button" onClick={() => setNotice(false)} aria-label="Dismiss notice" data-testid="button-dismiss-store-notice"><X size={15} /></button>
      </div>}

      {selected && <div className="st-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeOverlay(); }}>
        <section className="st-sheet" role="dialog" aria-modal="true" aria-label={selected ? 'Item details' : inventory ? 'My items' : 'Category listing'} data-testid="dialog-store-sheet">
          <button type="button" className="st-sheet-close" onClick={closeOverlay} aria-label="Close" data-testid="button-close-store-sheet"><X size={20} /></button>
          {(modalBadge || modalEffect || modalGift) && <div className="st-detail">
            <span className="st-overline">{selected.type === 'badges' ? 'STATUS COLLECTION' : selected.type === 'effects' ? 'ENTRANCE EFFECT' : 'GIFT COLLECTIBLE'}</span>
            {art(selected.type, modalBadge ?? modalEffect ?? modalGift, 'large')}
            <h2>{(modalBadge ?? modalEffect ?? modalGift)?.name}</h2>
            {selected.type === 'badges' && modalBadge && <>
              <p>{modalBadge.description || 'A distinctive mark in the Deux Wild community.'}</p>
              <div className="st-detail-fact"><LockKeyhole size={16} /><span>Automatically earned from qualifying completed monthly coin purchases. Not purchasable with wallet coins.</span></div>
              <div className="st-detail-price"><Coins size={17} /> {formatCredits(modalBadge.cost)} <small>monthly qualifying spend</small></div>
              <button type="button" className="st-detail-action is-disabled" disabled data-testid={`button-detail-auto-${modalBadge.id}`}><LockKeyhole size={16} /> Auto-earned</button>
            </>}
            {selected.type === 'effects' && modalEffect && <>
              <p>{modalEffect.equipped ? 'Currently equipped for your room arrivals.' : modalEffect.owned ? 'Ready to use in your collection.' : 'Preview the effect, then add it to your collection.'}</p>
              <div className="st-detail-price"><Coins size={17} /> {formatCredits(modalEffect.cost)} <small>coins</small></div>
              {wallet && !wallet.unlimited && wallet.balance < modalEffect.cost && <div className="st-detail-coin-note"><span>Not enough coins.</span><button type="button" onClick={() => setNotice(true)}><Plus size={14} /> Add coins</button></div>}
              <div className="st-detail-actions">
                <button type="button" className="st-detail-preview" disabled={!modalEffect.media} onClick={() => { setPreviewId(previewId === modalEffect.id ? null : modalEffect.id); setFallbackPreviewId(null); }} data-testid={`button-detail-preview-${modalEffect.id}`}><Play size={16} /> {previewId === modalEffect.id ? 'Close preview' : 'Preview'}</button>
                <button type="button" className="st-detail-action" disabled={!modalEffect.availableForPurchase || modalEffect.owned || purchase.isPending || (!wallet?.unlimited && (wallet?.balance ?? 0) < modalEffect.cost)} onClick={() => buyEffect(modalEffect.id)} data-testid={`button-detail-buy-effect-${modalEffect.id}`}>
                  {purchase.isPending && purchase.variables?.effectId === modalEffect.id ? 'Adding…' : modalEffect.equipped ? 'Equipped' : modalEffect.owned ? 'Owned' : !modalEffect.availableForPurchase ? 'Coming soon' : !wallet?.unlimited && (wallet?.balance ?? 0) < modalEffect.cost ? 'Not enough coins' : 'Buy effect'}
                </button>
              </div>
            </>}
            {selected.type === 'gifts' && modalGift && <>
              <p>Collect a copy for your bag. Buying does not send this gift or alter gift receipts or history.</p>
              <div className="st-detail-price"><Coins size={17} /> {formatCredits(modalGift.cost)} <small>coins</small></div>
              {wallet && !wallet.unlimited && wallet.balance < modalGift.cost && <div className="st-detail-coin-note"><span>Not enough coins.</span><button type="button" onClick={() => setNotice(true)}><Plus size={14} /> Add coins</button></div>}
              {(me.data?.giftQuantities?.[modalGift.id] ?? 0) > 0 && <div className="st-detail-fact"><ShoppingBag size={16} /><span>In your bag: {me.data?.giftQuantities?.[modalGift.id]}</span></div>}
              <button type="button" className="st-detail-action" disabled={giftPurchase.isPending || (!wallet?.unlimited && (wallet?.balance ?? 0) < modalGift.cost)} onClick={() => buyGift(modalGift.id, modalGift.name)} data-testid={`button-detail-buy-gift-${modalGift.id}`}>
                {giftPurchase.isPending && giftPurchase.variables?.data.itemId === modalGift.id ? 'Adding…' : (!wallet?.unlimited && (wallet?.balance ?? 0) < modalGift.cost) ? 'Not enough coins' : 'Buy'}
              </button>
            </>}
          </div>}
          {message && <div className="st-sheet-message" role="status" data-testid="status-store-sheet-message">{message.text}</div>}
        </section>
      </div>}
    </main>
  );
}
