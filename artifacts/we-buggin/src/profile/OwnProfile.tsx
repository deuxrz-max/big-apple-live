import { Link } from 'wouter';
import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetSocialMeQueryKey, useGetChatAccess, useGetSocialMe, useSaveSocialProfile,
  type SocialPerson,
} from '@workspace/api-client-react';
import '@/beam/beam.css';
import '@/social/social.css';
import { ErrorBox, Loading } from '@/social/common';
import { refreshSocial } from '@/social/common';
import { RewardsPage } from '@/social/MoneyPages';
import { ProfileView } from './ProfileView';

const STARTER_JOBS = ['Apprentice', 'Squire', 'Initiate', 'Trapper', 'Novice', 'Acolyte', 'Scoundrel', 'Tinker'] as const;
type StarterJob = typeof STARTER_JOBS[number];

function PlayerIdentitySettings({ profile }: { profile: SocialPerson }) {
  const queryClient = useQueryClient();
  const save = useSaveSocialProfile();
  const [job, setJob] = useState<StarterJob | null>((profile.job as StarterJob | null | undefined) ?? null);
  const [notice, setNotice] = useState('');
  useEffect(() => setJob((profile.job as StarterJob | null | undefined) ?? null), [profile.job]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice('');
    save.mutate({ data: {
      bio: profile.bio ?? '',
      country: profile.country ?? null,
      interests: profile.interests ?? [],
      discoverable: profile.discoverable ?? false,
      badgeId: null,
      externalPlatform: profile.externalPlatform ?? null,
      externalHandle: profile.externalHandle ?? null,
      race: 'Human',
      job,
    } }, {
      onSuccess: () => {
        setNotice('Race and job saved.');
        refreshSocial(queryClient);
        void queryClient.invalidateQueries({ queryKey: getGetSocialMeQueryKey() });
      },
      onError: () => setNotice('Could not save. Please try again.'),
    });
  };
  return (
    <section className="pf-player-identity" aria-labelledby="pf-player-identity-title" data-testid="section-player-identity">
      <h2 id="pf-player-identity-title">Player identity</h2>
      <p>Choose the details shown on your seat in social rooms.</p>
      <form onSubmit={submit}>
        <label><span>Race</span>
          <select value="Human" disabled aria-label="Race" data-testid="select-player-race"><option value="Human">Human</option></select>
        </label>
        <label><span>Job</span>
          <select value={job ?? ''} onChange={event => setJob(event.target.value ? event.target.value as StarterJob : null)} aria-label="Job" data-testid="select-player-job">
            <option value="">No job yet</option>
            {STARTER_JOBS.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        {notice && <p role="status" data-testid="status-player-identity">{notice}</p>}
        <button type="submit" className="bm-btn bm-btn-primary" disabled={save.isPending} data-testid="button-save-player-identity">
          {save.isPending ? 'Saving…' : 'Save race and job'}
        </button>
      </form>
    </section>
  );
}

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
       <PlayerIdentitySettings profile={p} />
       <div className="sc pf-rewards"><RewardsPage embedded /></div>
    </ProfileView>
  );
}
