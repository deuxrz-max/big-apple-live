import { useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowLeft, Check, Coins, Crown, Eye, Flame, Gem, Gift, Heart, LockKeyhole,
  Moon, Play, Shield, ShoppingBag, Sparkles, Star, WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import './_group.css';

type StoreSection = 'badges' | 'effects' | 'gifts';
const SECTIONS: { id: StoreSection; label: string; icon: LucideIcon }[] = [
  { id: 'badges', label: 'Badges', icon: Sparkles },
  { id: 'effects', label: 'Entrance Effects', icon: WandSparkles },
  { id: 'gifts', label: 'Gifts', icon: Gift },
];

// A signed-in member and populated shop are represented locally for this visual baseline.
const wallet = { balance: 2840, unlimited: false };
const products = [
  { id: 'monthly-tier-1', name: 'Rising Star', description: 'A first milestone in the Streamtalk community.', cost: 25, Icon: Star, earned: true },
  { id: 'monthly-tier-2', name: 'Silver Circle', description: 'A mark of your growing place in the community.', cost: 75, Icon: Shield, earned: true },
  { id: 'monthly-tier-3', name: 'Golden Voice', description: 'Recognized for your continued support.', cost: 150, Icon: Crown, earned: false },
  { id: 'monthly-tier-4', name: 'Cosmic Legend', description: 'An unmistakable mark of your community presence.', cost: 300, Icon: Gem, earned: false },
];
const effects = [
  { id: 'starlight-arrival', name: 'Starlight Arrival', cost: 450, duration: 5, owned: false, equipped: false, availableForPurchase: true, Icon: Sparkles },
  { id: 'violet-flare', name: 'Violet Flare', cost: 700, duration: 4, owned: true, equipped: true, availableForPurchase: true, Icon: Flame },
  { id: 'moonlit-drift', name: 'Moonlit Drift', cost: 900, duration: 6, owned: false, equipped: false, availableForPurchase: false, Icon: Moon },
];
const gifts = [
  { id: 'heart', name: 'Heart', cost: 25, quantity: 3, Icon: Heart },
  { id: 'spirit-pup', name: 'Spirit Pup', cost: 120, quantity: 1, Icon: Star },
  { id: 'moonfox', name: 'Moonfox', cost: 240, quantity: 0, Icon: Moon },
  { id: 'cosmic-encore', name: 'Cosmic Encore', cost: 900, quantity: 0, Icon: Sparkles },
];

function formatCredits(value: number) {
  return value.toLocaleString();
}

function Wordmark() {
  return (
    <a href="#" onClick={(event) => event.preventDefault()} className="st-wordmark-lockup st-store-wordmark" aria-label="STREAMTALK home">
      <Shield size={30} strokeWidth={2.1} aria-hidden="true" />
      <span className="st-wordmark">STREAMTALK</span>
    </a>
  );
}

export function Current() {
  const [section, setSection] = useState<StoreSection>('badges');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activePanelId = `store-panel-${section}`;

  const selectByKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? SECTIONS.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : SECTIONS.length - 1)) % SECTIONS.length;
    setSection(SECTIONS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <main className="st-store" data-testid="page-store">
      <div className="st-store-wrap">
        <header className="st-store-top">
          <Wordmark />
          <div className="st-store-wallet" data-testid="text-store-balance" aria-label="Current credit balance">
            <span className="st-store-wallet-icon"><Coins size={17} aria-hidden="true" /></span>
            <span className="st-store-wallet-copy"><small>YOUR BALANCE</small><strong>{wallet.unlimited ? 'Unlimited test' : formatCredits(wallet.balance)} <i>credits</i></strong></span>
          </div>
        </header>
        <a href="#" onClick={(event) => event.preventDefault()} className="st-store-back" data-testid="link-store-profile">
          <ArrowLeft size={17} aria-hidden="true" />
          <span>Back to profile</span>
        </a>

        <section className="st-store-intro">
          <span className="st-store-eyebrow"><span /> MEMBERS ONLY / 18+</span>
          <h1>The Store<span>.</span></h1>
          <p>Wear your status. Make an entrance. Send a little something.</p>
        </section>

        {message && <div className="st-store-message" role="status">{message}</div>}
        <div className="st-store-tabs" role="tablist" aria-label="Store categories">
          {SECTIONS.map(({ id, label, icon: Icon }, index) => (
            <button
              key={id}
              ref={(node) => { tabRefs.current[index] = node; }}
              type="button"
              role="tab"
              id={`store-tab-${id}`}
              aria-selected={section === id}
              aria-controls={`store-panel-${id}`}
              tabIndex={section === id ? 0 : -1}
              className={`st-store-tab${section === id ? ' is-selected' : ''}`}
              onClick={() => setSection(id)}
              onKeyDown={(event) => selectByKeyboard(event, index)}
              data-testid={`tab-store-${id}`}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <section
          className="st-store-panel"
          id={activePanelId}
          role="tabpanel"
          aria-labelledby={`store-tab-${section}`}
          tabIndex={0}
        >
          {section === 'badges' && (
            <div className="st-store-section">
              <div className="st-store-section-heading">
                <div><span className="st-store-kicker">YOUR REPUTATION, IN FULL COLOR</span><h2>Badges</h2></div>
                <span className="st-store-count">{products.length.toString().padStart(2, '0')} TIERS</span>
              </div>
              <div className="st-store-rule-note">
                <LockKeyhole size={17} aria-hidden="true" />
                <p>Badges are earned automatically from confirmed, completed credit purchases. They are not bought with wallet credits.</p>
              </div>
              <div className="st-store-badges">
                {products.map((product, index) => {
                  const active = product.id === 'monthly-tier-2';
                  const BadgeIcon = product.Icon;
                  return (
                    <article className={`st-store-badge-card${active ? ' is-active' : ''}`} key={product.id} data-testid={`card-store-badge-${product.id}`}>
                      <div className="st-store-badge-art">
                        <span className="st-store-badge-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className="sc-badge-art-slot"><span className="st-store-badge-glyph"><BadgeIcon size={34} strokeWidth={1.7} aria-hidden="true" /></span></span>
                      </div>
                      <div className="st-store-badge-copy">
                        <div className="st-store-badge-title"><h3>{product.name}</h3>{active && <span className="st-store-pill is-active"><Check size={12} /> Active</span>}</div>
                        <p>{product.description}</p>
                        <div className="st-store-badge-meta">
                          <span>{formatCredits(product.cost)} <small>monthly qualifying spend</small></span>
                          <span className={`st-store-badge-status${product.earned ? ' is-earned' : ''}`}>{active ? 'Current highest tier' : product.earned ? 'Previously earned' : 'Earned automatically'}</span>
                        </div>
                      </div>
                      <button type="button" className="st-store-disabled-action" disabled aria-label={`${product.name} badge cannot be purchased directly`}>
                        <LockKeyhole size={14} aria-hidden="true" /> Auto-earned
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {section === 'effects' && (
            <div className="st-store-section">
              <div className="st-store-section-heading">
                <div><span className="st-store-kicker">MAKE THE ROOM NOTICE</span><h2>Entrance Effects</h2></div>
                <span className="st-store-count">{effects.length.toString().padStart(2, '0')} EFFECTS</span>
              </div>
              <div className="st-store-effects">
                {effects.map((effect) => {
                  const isPreviewing = previewId === effect.id;
                  const EffectIcon = effect.Icon;
                  return (
                    <article className={`st-store-effect-card${effect.owned ? ' is-owned' : ''}`} key={effect.id} data-testid={`card-store-effect-${effect.id}`}>
                      <div className="st-store-effect-art">
                        <div className="st-store-effect-art-placeholder">
                          <EffectIcon size={30} aria-hidden="true" />
                          <span>{isPreviewing ? 'PREVIEW PLAYING' : 'PREVIEW READY'}</span>
                        </div>
                        {(effect.equipped || effect.owned) && <span className="st-store-effect-ribbon">{effect.equipped ? 'EQUIPPED' : 'OWNED'}</span>}
                      </div>
                      <div className="st-store-effect-info">
                        <div className="st-store-effect-title"><h3>{effect.name}</h3><strong><Coins size={14} />{formatCredits(effect.cost)}</strong></div>
                        <span className="st-store-effect-duration">{effect.duration} sec</span>
                        <p>{effect.equipped ? 'This effect is currently equipped.' : effect.owned ? 'Ready in your collection.' : 'A signature arrival for your next room.'}</p>
                        <div className="st-store-effect-actions">
                          <button type="button" className="st-store-preview" aria-pressed={isPreviewing} onClick={() => setPreviewId(isPreviewing ? null : effect.id)} data-testid={`button-preview-effect-${effect.id}`}>
                            {isPreviewing ? <Eye size={15} /> : <Play size={15} />}
                            {isPreviewing ? 'Close preview' : 'Preview'}
                          </button>
                          <button
                            type="button"
                            className="st-store-buy"
                            disabled={effect.owned || effect.equipped || !effect.availableForPurchase}
                            onClick={() => setMessage(`${effect.name} added to your collection.`)}
                            data-testid={`button-purchase-effect-${effect.id}`}
                          >
                            {effect.owned ? 'Owned' : effect.equipped ? 'Equipped' : !effect.availableForPurchase ? 'Coming soon' : 'Get effect'}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {section === 'gifts' && (
            <div className="st-store-section">
              <div className="st-store-section-heading">
                <div><span className="st-store-kicker">A SMALL GESTURE, A BIG MOMENT</span><h2>Gifts</h2></div>
                <span className="st-store-count">{gifts.length.toString().padStart(2, '0')} ITEMS</span>
              </div>
              <div className="st-store-gift-note"><ShoppingBag size={17} aria-hidden="true" /><p>Buy a collectible copy for your bag here. Sending a gift in a room still uses the regular send flow and costs its listed credits.</p></div>
              <div className="st-store-gifts">
                {gifts.map((gift, index) => {
                  const GiftIconComponent = gift.Icon;
                  return (
                    <article className="st-store-gift-card" key={gift.id} data-testid={`card-store-gift-${gift.id}`}>
                      <span className="st-store-gift-index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="st-store-gift-icon"><GiftIconComponent size={30} strokeWidth={1.7} aria-hidden="true" /></span>
                      <div className="st-store-gift-copy"><h3>{gift.name}</h3><span><Coins size={13} /> {formatCredits(gift.cost)} credits</span>
                        {gift.quantity > 0 && <small className="st-store-gift-owned">In collection: {gift.quantity}</small>}
                      </div>
                      <button
                        type="button"
                        className="st-store-gift-buy"
                        disabled={!wallet.unlimited && wallet.balance < gift.cost}
                        onClick={() => setMessage(`${gift.name} was added to your gift collection.`)}
                        data-testid={`button-purchase-gift-${gift.id}`}
                      >
                        Buy
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </section>
        <footer className="st-store-footer"><span>STREAMTALK / MEMBER STORE</span><span>Balance updates with your wallet.</span></footer>
      </div>
    </main>
  );
}
