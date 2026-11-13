import { Link } from 'wouter';
import { useEffect } from 'react';
import {
  getGetSocialMeQueryKey, useGetChatAccess, useGetSocialMe,
} from '@workspace/api-client-react';
import '@/beam/beam.css';
import '@/social/social.css';
import { ErrorBox, Loading } from '@/social/common';
import { RewardsPage } from '@/social/MoneyPages';
import { ProfileView } from './ProfileView';

export function OwnProfile() {
  const me = useGetSocialMe({ query: { queryKey: getGetSocialMeQueryKey(), refetchInterval: 15000 } });
  const access = useGetChatAccess();
  if (me.isLoading) return <div className="pf pf-panel pf-panel-solo"><Loading /></div>;
  if (me.isError || !me.data) return <div className="pf pf-panel pf-panel-solo"><ErrorBox error={me.error} retry={() => me.refetch()} /></div>;
  const p = me.data.profile;
  const savedCountry = me.data.countries.find((c) => c.code === p.country);
  const countryName = p.country ? (savedCountry?.name ?? p.country) : undefined;
  return (
    <ProfileView person={p} own countryName={countryName} backHref="/home"
      links={
        <nav className="pf-links dw-shortcuts" data-testid="nav-profile-shortcuts" aria-label="Profile shortcuts">
          <Link href="/community" className="pf-btn" data-testid="link-community">Community</Link>
          <Link href="/community/profile" className="pf-btn" data-testid="link-platform-bio">Platform and bio</Link>
          {access.data?.owner && <Link href="/community/coin-testers" className="pf-btn" data-testid="link-owner-tools">Owner tools</Link>}
          {access.data?.owner && access.data.adultConfirmed && <Link href="/user-portal/photo-reviews" className="pf-btn" data-testid="link-profile-photo-review">Review pending photos</Link>}
          {access.data?.moderator && <Link href="/community/moderation" className="pf-btn" data-testid="link-moderation">Moderation</Link>}
        </nav>
      }>
      <div className="sc pf-rewards"><RewardsPage embedded /></div>
    </ProfileView>
  );
}
