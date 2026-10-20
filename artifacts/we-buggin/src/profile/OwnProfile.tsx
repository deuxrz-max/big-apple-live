import { Link } from 'wouter';
import { useEffect, useState } from 'react';
import { Coins, ShoppingBag } from 'lucide-react';
import {
  getGetSocialMeQueryKey, useGetChatAccess, useGetSocialMe, useSetMyNameColorTestTotal,
} from '@workspace/api-client-react';
import '@/beam/beam.css';
import '@/social/social.css';
import { ErrorBox, Loading } from '@/social/common';
import { RewardsPage } from '@/social/MoneyPages';
import { ProfileView } from './ProfileView';
import { GiftBag, GiftControl } from '@/gifts';
import { MyStreamerPassport } from '@/passport/StreamerPassport';
import { EntranceEffectsShop } from './EntranceEffectsShop';

export function OwnProfile() {
  const [bagOpen, setBagOpen] = useState(false);
  const [testTotal, setTestTotal] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const me = useGetSocialMe({ query: { queryKey: getGetSocialMeQueryKey(), refetchInterval: 15000 } });
  const access = useGetChatAccess();
  const nameColorTest = useSetMyNameColorTestTotal();
  useEffect(() => {
    if (testTotal === null && me.data) {
      setTestTotal(String(me.data.nameColorTest.overrideCoins ?? me.data.nameColorProgress.lifetimeCoinsPurchased));
    }
  }, [testTotal, me.data]);
  if (me.isLoading) return <div className="pf pf-panel pf-panel-solo"><Loading /></div>;
  if (me.isError || !me.data) return <div className="pf pf-panel pf-panel-solo"><ErrorBox error={me.error} retry={() => me.refetch()} /></div>;
  const p = me.data.profile;
  const passportCountry = me.data.countries.find((c) => c.code === p.country);
  const countryName = p.country ? (passportCountry?.name ?? p.country) : undefined;
  const nameProgress = me.data.nameColorProgress;
  const saveNameColorTestTotal = (totalCoins: number | null) => {
    setTestMessage(null);
    nameColorTest.mutate({ data: { totalCoins } }, {
      onSuccess: (result) => {
        setTestTotal(String(result.overrideCoins ?? result.progress.lifetimeCoinsPurchased));
        setTestMessage(totalCoins === null ? 'Test override cleared.' : `Preview set to ${result.progress.tierName}.`);
        void me.refetch();
      },
      onError: (error) => setTestMessage(error instanceof Error ? error.message : 'Could not update the preview tier.'),
    });
  };
  return (
    <ProfileView person={p} own countryName={countryName} passportCountry={passportCountry} products={me.data.products} backHref="/home"
      links={
        <nav className="pf-links" aria-label="Profile shortcuts">
          <Link href="/user-portal/store" className="pf-btn pf-btn-store" data-testid="link-profile-store"><ShoppingBag size={17} aria-hidden="true" /> Store</Link>
          <Link href="/user-portal/transactions" className="pf-btn" data-testid="link-transaction-history">Transaction History</Link>
          <Link href="/community" className="pf-btn" data-testid="link-community">Community</Link>
          <Link href="/community/profile" className="pf-btn" data-testid="link-platform-bio">Platform and bio</Link>
          <Link href="#streamer-passport" className="pf-btn" data-testid="link-streamer-passport">Streamer passport</Link>
          {access.data?.owner && access.data.adultConfirmed && <Link href="/user-portal/photo-reviews" className="pf-btn" data-testid="link-profile-photo-review">Review pending photos</Link>}
          {access.data?.moderator && <Link href="/community/moderation" className="pf-btn" data-testid="link-moderation">Moderation</Link>}
          {access.data?.owner && <Link href="/community/gift-studio" className="pf-btn" data-testid="link-gift-studio">Gift Studio</Link>}
        </nav>
      }>
      <section className="pf-name-tier" aria-label="Gifting level">
        <div className="pf-name-tier-copy">
          <span className="pf-name-tier-kicker">Gifting level</span>
          <strong>{nameProgress.tierName}</strong>
          <span>
            {nameProgress.nextTierName
              ? `${nameProgress.coinsToNextTier.toLocaleString()} more coins to ${nameProgress.nextTierName}`
              : 'You have reached the highest gifting level.'}
          </span>
          <small>Based on the cumulative coin value of gifts successfully sent. Recharges and failed sends do not count.</small>
        </div>
        {me.data.nameColorTest.enabled && (
          <div className="pf-name-tier-test">
            <label htmlFor="name-color-test-total">Development-only tier preview</label>
            <p>This changes only your preview gifting level, not your wallet or gift history.</p>
            <div className="pf-name-tier-test-row">
              <input id="name-color-test-total" type="number" min="0" step="1"
                value={testTotal ?? ''} onChange={(event) => setTestTotal(event.target.value)}
                aria-label="Successful gift coin value for gifting-level preview" />
              <button type="button" className="pf-btn" disabled={nameColorTest.isPending}
                onClick={() => {
                  const value = testTotal?.trim() ?? '';
                  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
                    setTestMessage('Enter a whole number of 0 or more.');
                    return;
                  }
                  saveNameColorTestTotal(Number(value));
                }}>
                {nameColorTest.isPending ? 'Saving…' : 'Preview tier'}
              </button>
            </div>
            <button type="button" className="pf-name-tier-reset" disabled={nameColorTest.isPending}
              onClick={() => saveNameColorTestTotal(null)}>Clear test override</button>
            {testMessage && <span className="pf-name-tier-status" role="status">{testMessage}</span>}
          </div>
        )}
      </section>
      <Link href="/community/coins" className="pf-btn" data-testid="link-buy-credits"><Coins size={16} aria-hidden="true" style={{ color: '#f5cb8d' }} /> Buy coins</Link>
      <GiftControl onClick={() => setBagOpen(true)} label="Open your gift bag" />
      {bagOpen && <GiftBag onClose={() => setBagOpen(false)} />}
      <EntranceEffectsShop />
      <div id="streamer-passport"><MyStreamerPassport /></div>
      <div className="sc pf-rewards"><RewardsPage embedded /></div>
    </ProfileView>
  );
}
