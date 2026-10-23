import { Link } from 'wouter';
import { useEffect, useState, type CSSProperties } from 'react';
import { GIFTING_LEVEL_THRESHOLDS, giftingTier } from '@workspace/beam-identity';
import { GiftingShield } from '@/gifting/GiftingShield';
import { profileGiftingProgress } from '@/gifting/gifting';
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
  const savedCountry = me.data.countries.find((c) => c.code === p.country);
  const countryName = p.country ? (savedCountry?.name ?? p.country) : undefined;
  const nameProgress = me.data.nameColorProgress;
  const gifting = profileGiftingProgress(nameProgress.tierIndex, nameProgress.lifetimeCoinsPurchased);
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
    <ProfileView person={p} own countryName={countryName} products={me.data.products} backHref="/home"
      links={
        <nav className="pf-links dw-shortcuts" data-testid="nav-profile-shortcuts" aria-label="Profile shortcuts">
          <Link href="/user-portal/store" className="pf-btn pf-btn-store" data-testid="link-profile-store"><ShoppingBag size={17} aria-hidden="true" /> Store</Link>
          <Link href="/user-portal/transactions" className="pf-btn" data-testid="link-transaction-history">Transaction History</Link>
          <Link href="/community" className="pf-btn" data-testid="link-community">Community</Link>
          <Link href="/community/profile" className="pf-btn" data-testid="link-platform-bio">Platform and bio</Link>
          {access.data?.owner && access.data.adultConfirmed && <Link href="/user-portal/photo-reviews" className="pf-btn" data-testid="link-profile-photo-review">Review pending photos</Link>}
          {access.data?.moderator && <Link href="/community/moderation" className="pf-btn" data-testid="link-moderation">Moderation</Link>}
          {import.meta.env.DEV && access.data?.owner === true && <Link href="/user-portal/card-finish" className="pf-btn" data-testid="link-card-finish-preview">Card finish preview</Link>}
          {access.data?.owner && <Link href="/community/gift-studio" className="pf-btn" data-testid="link-gift-studio">Gift Studio</Link>}
        </nav>
      }>
      <section className="pf-name-tier" aria-label="Gifting level" data-testid="section-gifting-level">
        <div className="pf-name-tier-copy pf-gifting-level">
          {gifting.level > 0
            ? <GiftingShield level={gifting.level} size={52} />
            : <span className="pf-name-tier-kicker" aria-hidden="true">--</span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="pf-name-tier-kicker">Gifting level</span>
            <strong data-testid="text-gifting-level">
              {gifting.level > 0 ? `${gifting.tier.name} · Level ${gifting.level}` : 'No gifting level yet'}
            </strong>
            {gifting.isMax ? (
              <span data-testid="text-gifting-max">Maximum level reached. {gifting.xp.toLocaleString()} total XP.</span>
            ) : (
              <>
                <div className="pf-gifting-meter" role="progressbar" aria-label="Progress to next gifting level"
                  aria-valuemin={0} aria-valuemax={gifting.xpForNextLevel} aria-valuenow={gifting.currentLevelXp}
                  style={{ '--gifting-meter': gifting.tier.color } as CSSProperties}>
                  <span style={{ transform: `scaleX(${gifting.xpForNextLevel > 0 ? Math.min(1, gifting.currentLevelXp / gifting.xpForNextLevel) : 0})` }} />
                </div>
                <span data-testid="text-gifting-progress">
                  {gifting.currentLevelXp.toLocaleString()} / {gifting.xpForNextLevel.toLocaleString()} XP to Level {gifting.level + 1}
                  {' · '}{gifting.xpRemaining.toLocaleString()} to go
                </span>
                <span data-testid="text-gifting-total">Total XP {gifting.xp.toLocaleString()}</span>
              </>
            )}
          </div>
        </div>
        <small>Every successfully sent gift adds its coin value as XP. Recharges and failed sends do not count. Silver unlocks a tier name color, Gold a seat frame and entrance banner, Platinum an animated frame, entrance effect and exclusive gifts, Deux Wild a neon full-screen entrance.</small>
        {me.data.nameColorTest.enabled && (
          <div className="pf-name-tier-test">
            <label htmlFor="name-color-test-level">Development-only level preview</label>
            <p>This changes only your preview gifting level, not your wallet or gift history.</p>
            <div className="pf-name-tier-test-row">
              <select id="name-color-test-level" aria-label="Jump to gifting level" data-testid="select-gifting-preview-level"
                value="" onChange={(event) => {
                  const lvl = Number(event.target.value);
                  if (Number.isInteger(lvl)) setTestTotal(String(GIFTING_LEVEL_THRESHOLDS[lvl] ?? 0));
                }}>
                <option value="" disabled>Jump to level</option>
                {GIFTING_LEVEL_THRESHOLDS.map((xp, lvl) => (
                  <option key={lvl} value={lvl}>{lvl === 0 ? 'No level (0 XP)' : `Level ${lvl} · ${giftingTier(lvl).name} (${xp.toLocaleString()} XP)`}</option>
                ))}
              </select>
            </div>
            <div className="pf-name-tier-test-row">
              <input id="name-color-test-total" type="number" min="0" step="1" data-testid="input-gifting-preview-xp"
                value={testTotal ?? ''} onChange={(event) => setTestTotal(event.target.value)}
                aria-label="Successful gift XP for gifting-level preview" />
              <button type="button" className="pf-btn" disabled={nameColorTest.isPending} data-testid="button-gifting-preview"
                onClick={() => {
                  const value = testTotal?.trim() ?? '';
                  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
                    setTestMessage('Enter a whole number of 0 or more.');
                    return;
                  }
                  saveNameColorTestTotal(Number(value));
                }}>
                {nameColorTest.isPending ? 'Saving…' : 'Preview level'}
              </button>
            </div>
            <button type="button" className="pf-name-tier-reset" disabled={nameColorTest.isPending}
              onClick={() => saveNameColorTestTotal(null)} data-testid="button-clear-gifting-preview">Clear test override</button>
            <p>Preview levels never unlock Platinum-exclusive gifts; the server checks your real gift XP.</p>
            {testMessage && <span className="pf-name-tier-status" role="status">{testMessage}</span>}
          </div>
        )}
      </section>
      <div className="dw-me-actions" data-testid="group-me-actions">
        <Link href="/community/coins" className="pf-btn" data-testid="link-buy-credits"><Coins size={16} aria-hidden="true" style={{ color: '#f5cb8d' }} /> Buy coins</Link>
        <GiftControl onClick={() => setBagOpen(true)} label="Open your gift bag" />
      </div>
      {bagOpen && <GiftBag onClose={() => setBagOpen(false)} />}
      <EntranceEffectsShop />
      <div className="sc pf-rewards"><RewardsPage embedded /></div>
    </ProfileView>
  );
}
