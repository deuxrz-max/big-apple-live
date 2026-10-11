import { useState } from 'react';
import { Link } from 'wouter';
import { Coins } from 'lucide-react';
import { useGetSocialMe, getGetSocialMeQueryKey } from '@workspace/api-client-react';
import { ErrorBox, Loading } from './common';
import { CREDIT_BUNDLES, formatUsd, savingsPercent, type CreditBundle } from './credit-catalog';
import './buy-credits.css';

export function BuyCreditsPage() {
  const me = useGetSocialMe({ query: { queryKey: getGetSocialMeQueryKey(), staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always' } });
  const [sel, setSel] = useState<CreditBundle | null>(null);
  if (me.isLoading) return <Loading />;
  if (me.isError || !me.data) return <ErrorBox error={me.error} retry={() => me.refetch()} />;
  const balance = me.data.wallet.balance;
  return (
    <section className="bc" data-testid="page-buy-credits">
      <Link href="/user-portal" className="bm-back" data-testid="link-credits-back">My profile</Link>
      <h1 className="bm-h1 sc-h1">Buy credits</h1>
      <p className="bc-bal"><Coins size={18} aria-hidden /> Current balance: <b data-testid="text-credits-balance">{me.data.wallet.unlimited ? 'Unlimited test credits' : balance.toLocaleString()}</b>{!me.data.wallet.unlimited && ' credits'}</p>
      {!sel ? (
        <>
          <p className="bc-txt">Choose a bundle.</p>
          <ul className="bc-list">
            {CREDIT_BUNDLES.map((b) => { const s = savingsPercent(b); return (
              <li key={b.id}>
                <button type="button" className="bc-card" onClick={() => setSel(b)} data-testid={`card-bundle-${b.credits}`}>
                  <span className="bc-cr">{b.credits.toLocaleString()} credits</span>
                  <span className="bc-price">{formatUsd(b.priceCents)}</span>
                  {s > 0 && <span className="bc-save">Save about {s}% per credit</span>}
                </button>
              </li>); })}
          </ul>
        </>
      ) : (
        <div className="bc-review" role="region" aria-labelledby="bc-rev-h" data-testid="review-purchase">
          <h2 id="bc-rev-h">Review purchase</h2>
          <dl className="bc-dl">
            <div><dt>Credits</dt><dd data-testid="text-review-credits">{sel.credits.toLocaleString()}</dd></div>
            <div><dt>Price</dt><dd data-testid="text-review-price">{formatUsd(sel.priceCents)} USD</dd></div>
            <div><dt>Current balance</dt><dd data-testid="text-review-balance">{me.data.wallet.unlimited ? 'Unlimited test credits' : `${balance.toLocaleString()} credits`}</dd></div>
          </dl>
          <div className="bc-note" role="status" data-testid="text-checkout-unavailable">
            <b>Checkout unavailable</b>
            <p>Payments are not connected yet. You will not be charged and no credits will be added.</p>
          </div>
          <button type="button" className="bm-btn bm-btn-primary bc-pay" disabled aria-disabled="true" data-testid="button-pay-disabled">Pay {formatUsd(sel.priceCents)} (unavailable)</button>
          <button type="button" className="bm-btn" onClick={() => setSel(null)} data-testid="button-change-bundle">Back, change bundle</button>
        </div>
      )}
    </section>
  );
}
