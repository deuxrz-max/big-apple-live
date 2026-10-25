import { useState } from 'react';
import { Link } from 'wouter';
import { useHistoryState } from 'wouter/use-browser-location';
import { buyCoinsBackTarget } from './buy-coins-navigation';
import { useGetSocialMe, getGetSocialMeQueryKey } from '@workspace/api-client-react';
import { CoinAmount, ErrorBox, Loading } from './common';
import { CREDIT_BUNDLES, formatUsd, RECHARGE_PREVIEW_POLICY, type CreditBundle } from './credit-catalog';
import { profileGiftingProgress, giftingLabel } from '../gifting/gifting';
import { GiftingShield } from '../gifting/GiftingShield';
import './buy-credits.css';
import { ProfileTap } from '@/profile/QuickProfile';

export function BuyCreditsPage() {
  const backTarget = buyCoinsBackTarget(useHistoryState());
  const me = useGetSocialMe({ query: { queryKey: getGetSocialMeQueryKey(), staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always' } });
  const [sel, setSel] = useState<CreditBundle | null>(null);
  if (me.isLoading) return <Loading />;
  if (me.isError || !me.data) return <ErrorBox error={me.error} retry={() => me.refetch()} />;
  const { wallet, profile, nameColorProgress } = me.data;
  const g = profileGiftingProgress(nameColorProgress.tierIndex, nameColorProgress.lifetimeCoinsPurchased);
  const ratio = g.isMax || !g.xpForNextLevel ? 1 : Math.min(1, Math.max(0, g.currentLevelXp / g.xpForNextLevel));
  const balText = wallet.unlimited ? 'Unlimited test coins' : `${wallet.balance.toLocaleString()} coins`;
  const initials = (profile.displayName || '?').trim().slice(0, 2).toUpperCase();
  const policy = RECHARGE_PREVIEW_POLICY;

  return (
    <section className="bc" data-testid="page-buy-credits">
      <Link href={backTarget} className="bm-back" data-testid="link-credits-back">Back</Link>

      <header className="bc-head">
        <div className="bc-ph" data-testid="img-buy-profile">
          <ProfileTap username={profile.username} className="bc-ph-tap">{profile.photoUrl ? <img src={profile.photoUrl} alt="" /> : <span>{initials}</span>}</ProfileTap>
        </div>
        <div className="bc-who">
          <div className="bc-name">
            <span data-testid="text-buy-name">{profile.displayName || profile.username}</span>
            {g.level > 0 && <GiftingShield level={g.level} size={18} decorative />}
          </div>
          <span className="bc-sub">@{profile.username}</span>
          <div className="bc-lvl" data-testid="text-gifter-level">{giftingLabel(g.level)}</div>
          <div className="bc-bar" role="progressbar" aria-label="Gifting XP progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} data-testid="progress-gifter-xp">
            <i style={{ transform: `scaleX(${ratio})` }} />
          </div>
          <div className="bc-xp" data-testid="text-gifter-xp">
            {g.isMax ? `${g.xp.toLocaleString()} XP, max level` : `${g.currentLevelXp.toLocaleString()} / ${g.xpForNextLevel.toLocaleString()} XP to next level`}
          </div>
        </div>
      </header>

      <div className="bc-balbox">
        <span className="bc-k">Spendable balance</span>
        <b data-testid="text-credits-balance"><CoinAmount>{balText}</CoinAmount></b>
        <span className="bc-sub">All coins you can spend on gifts right now. Not an earned or redeemable amount.</span>
      </div>

      <h1 className="bm-h1 sc-h1 bc-h1">Buy coins</h1>
      <div className="bc-meth" data-testid="text-payment-methods">
        <span className="bc-chip">Credit / debit card</span>
        <span className="bc-sub">Cards only. Checkout not connected yet.</span>
      </div>

      {!sel ? (
        <>
          <p className="bc-flag" data-testid="text-bonus-proposal">
            <b>Proposal preview.</b> Bonus coins shown are proposed and not approved. Nothing can be purchased yet.
          </p>
          <ul className="bc-list">
            {CREDIT_BUNDLES.map((b) => (
              <li key={b.id}>
                <button type="button" className="bc-card" onClick={() => setSel(b)} data-testid={`card-bundle-${b.baseCoins}`}>
                  <span className="bc-k">Total coins</span>
                  <span className="bc-tot" data-testid={`text-total-${b.baseCoins}`}><CoinAmount>{b.credits.toLocaleString()}</CoinAmount></span>
                  <span className="bc-split">
                    <span data-testid={`text-base-${b.baseCoins}`}>{b.baseCoins.toLocaleString()} base</span>
                    <span className="bc-bon" data-testid={`text-bonus-${b.baseCoins}`}>+{b.bonusCoins.toLocaleString()} proposed bonus</span>
                  </span>
                  <span className="bc-price" data-testid={`text-price-${b.baseCoins}`}>{formatUsd(b.priceCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="bc-review" role="region" aria-labelledby="bc-rev-h" data-testid="review-purchase">
          <h2 id="bc-rev-h">Review purchase</h2>
          <dl className="bc-dl">
            <div><dt>Base coins</dt><dd data-testid="text-review-base">{sel.baseCoins.toLocaleString()}</dd></div>
            <div><dt>Proposed bonus</dt><dd data-testid="text-review-bonus">+{sel.bonusCoins.toLocaleString()}</dd></div>
            <div className="bc-dl-tot"><dt>Total coins (proposal)</dt><dd data-testid="text-review-credits"><CoinAmount>{sel.credits.toLocaleString()} coins</CoinAmount></dd></div>
            <div><dt>Price</dt><dd data-testid="text-review-price">{formatUsd(sel.priceCents)} USD</dd></div>
            <div><dt>Payment method</dt><dd>Credit / debit card</dd></div>
            <div><dt>Spendable balance</dt><dd data-testid="text-review-balance"><CoinAmount>{balText}</CoinAmount></dd></div>
          </dl>
          <div className="bc-note" role="status" data-testid="text-checkout-unavailable">
            <b>Checkout unavailable</b>
            <ul>
              {!policy.checkoutEnabled && <li>Payments are not connected. You will not be charged and no coins will be added.</li>}
              {!policy.processorFeesVerified && <li>Card processing fees are not verified yet.</li>}
              {!policy.bonusesApproved && <li>Bonus amounts are a proposal and require approval.</li>}
            </ul>
          </div>
          <button type="button" className="bm-btn bm-btn-primary bc-pay" disabled aria-disabled="true" data-testid="button-pay-disabled">Pay {formatUsd(sel.priceCents)} (unavailable)</button>
          <button type="button" className="bm-btn bc-back" onClick={() => setSel(null)} data-testid="button-change-bundle">Back, change bundle</button>
        </div>
      )}

      <aside className="bc-fine" data-testid="text-coin-terms">
        <p>Purchased and bonus coins are for gifting only and cannot be cashed out directly. Buying coins does not add gifting XP.</p>
        <p>Cash-out policy: only verified broadcaster-earned units qualify. 30,000 earned units = $100 minimum. Payouts are not enabled. This is not guaranteed income or a monthly payout schedule.</p>
      </aside>
    </section>
  );
}
