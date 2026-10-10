import { Link } from 'wouter';
import { useState } from 'react';
import { useGetChatAccess, useGetSocialMe, getGetSocialMeQueryKey } from '@workspace/api-client-react';
import '@/beam/beam.css';
import '@/social/social.css';
import { ErrorBox, Loading } from '@/social/common';
import { RewardsPage } from '@/social/MoneyPages';
import { ProfileView } from './ProfileView';
import { GiftBag, GiftControl } from '@/gifts';

export function OwnProfile() {
  const [bagOpen, setBagOpen] = useState(false);
  const me = useGetSocialMe({ query: { queryKey: getGetSocialMeQueryKey(), refetchInterval: 15000 } });
  const access = useGetChatAccess();
  if (me.isLoading) return <div className="pf pf-panel pf-panel-solo"><Loading /></div>;
  if (me.isError || !me.data) return <div className="pf pf-panel pf-panel-solo"><ErrorBox error={me.error} retry={() => me.refetch()} /></div>;
  const p = me.data.profile;
  const countryName = p.country ? (me.data.countries.find((c) => c.code === p.country)?.name ?? p.country) : undefined;
  return (
    <ProfileView person={p} own countryName={countryName} products={me.data.products} backHref="/home"
      links={
        <nav className="pf-links" aria-label="Profile shortcuts">
          <Link href="/community" className="pf-btn" data-testid="link-community">Community</Link>
          <Link href="/community/profile" className="pf-btn" data-testid="link-platform-bio">Platform and bio</Link>
          {access.data?.moderator && <Link href="/community/moderation" className="pf-btn" data-testid="link-moderation">Moderation</Link>}
        </nav>
      }>
      <Link href="/community/credits" className="pf-btn" data-testid="link-buy-credits">Buy credits</Link>
      <GiftControl onClick={() => setBagOpen(true)} />
      {bagOpen && <GiftBag onClose={() => setBagOpen(false)} />}
      <div className="sc pf-rewards"><RewardsPage embedded /></div>
    </ProfileView>
  );
}
