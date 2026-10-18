import {
  ArrowLeft, BadgeCheck, Coins, Crown, Gift, Heart, House, MessageCircle,
  Plus, ShoppingBag, Sparkles, Star, UserRound, WandSparkles,
} from 'lucide-react';
import './_group.css';

const samples = [
  { name: 'Rising Star', spend: '25', Icon: Star, tint: 'star' },
  { name: 'Silver Circle', spend: '75', Icon: Crown, tint: 'circle' },
];

export function StoreConcept() {
  return (
    <main className="st-store-concept" data-testid="mockup-streamtalk-store">
      <div className="stc-shell">
        <header className="stc-header">
          <div className="stc-back" aria-label="Back to profile"><ArrowLeft size={19} /></div>
          <h1>Store</h1>
          <div className="stc-items"><ShoppingBag size={15} /><span>My items</span></div>
        </header>

        <section className="stc-promo" aria-label="Store announcement">
          <span className="stc-promo-label"><Sparkles size={12} /> MEMBER SPOTLIGHT</span>
          <h2>THE STREAMTALK<br />STORE IS OPEN.</h2>
          <p>Find your signature in the collection.</p>
          <div className="stc-promo-orb" aria-hidden="true"><span /></div>
          <span className="stc-stamp">ST<small>18+</small></span>
        </section>

        <nav className="stc-launcher" aria-label="Store categories">
          <div className="stc-launch is-active"><span className="stc-launch-icon"><BadgeCheck size={22} /></span><strong>Badges</strong><small>Status, earned over time</small></div>
          <div className="stc-launch"><span className="stc-launch-icon"><WandSparkles size={22} /></span><strong>Entrance effects</strong><small>Make an entrance</small></div>
          <div className="stc-launch"><span className="stc-launch-icon"><Gift size={22} /></span><strong>Gifts</strong><small>Collectibles for your bag</small></div>
        </nav>

        <section className="stc-collection" aria-labelledby="stc-badges-title">
          <header className="stc-section-heading">
            <div>
              <span className="stc-title-pill" id="stc-badges-title"><BadgeCheck size={14} /> Badges <small>04</small></span>
              <span className="stc-section-deck">STATUS, EARNED OVER TIME</span>
            </div>
            <span className="stc-more">More Options <span aria-hidden="true">&gt;</span></span>
          </header>
          <p className="stc-rule"><span className="stc-lock">i</span> Badges are auto-earned from qualifying completed monthly credit purchases. Not purchasable with wallet credits.</p>
          <div className="stc-card-grid">
            {samples.map(({ name, spend, Icon, tint }, index) => (
              <article className="stc-card" key={name}>
                <div className={`stc-art stc-art-${tint}`}>
                  <span className="stc-card-index">0{index + 1}</span>
                  <span className="stc-medallion"><Icon size={43} strokeWidth={1.55} /></span>
                  {index === 0 && <span className="stc-earned-tag">COLLECTED</span>}
                </div>
                <div className="stc-card-info">
                  <strong>{name}</strong>
                  <span className="stc-price"><Coins size={13} /> {spend} <small>monthly qualifying spend</small></span>
                  <span className="stc-earned">Auto-earned / not purchasable</span>
                </div>
                <span className="stc-card-chevron" aria-hidden="true">&gt;</span>
              </article>
            ))}
          </div>
        </section>

        <footer className="stc-footnote">STREAMTALK / MEMBER STORE</footer>
      </div>

      <aside className="stc-balance" aria-label="Current credit balance">
        <span className="stc-balance-coin"><Coins size={18} /></span>
        <span className="stc-credit-label">CREDITS</span>
        <strong>2,840</strong>
        <span className="stc-plus"><Plus size={18} /></span>
      </aside>
      <nav className="stc-bottom-nav" aria-label="Main navigation">
        <span><House size={18} strokeWidth={2.8} /><small>Home</small></span>
        <span><Heart size={18} strokeWidth={2.8} /><small>Following</small></span>
        <span><MessageCircle size={18} strokeWidth={2.8} /><small>Message</small></span>
        <span className="is-active"><UserRound size={18} strokeWidth={2.8} /><small>Me</small></span>
      </nav>
    </main>
  );
}
