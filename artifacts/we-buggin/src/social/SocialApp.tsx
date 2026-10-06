import { useEffect } from 'react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Users, Heart, Ban, MessageCircle, Coins, Trophy, UserRound, House } from 'lucide-react';
import { useGetSocialMe } from '@workspace/api-client-react';
import '@/beam/beam.css';
import './social.css';
import { ErrorBox, Loading, errStatus, refreshSocial } from './common';
import { BlocksPage, CommunityPage, FavoritesPage, MyProfilePage, PersonPage } from './PeoplePages';
import { InboxPage, LeaderboardPage, RewardsPage, ThreadPage } from './MoneyPages';

const NAV = [
  { to: '/community', label: 'People', icon: Users, exact: true },
  { to: '/community/favorites', label: 'Favorites', icon: Heart },
  { to: '/community/messages', label: 'Messages', icon: MessageCircle },
  { to: '/community/rewards', label: 'Rewards', icon: Coins },
  { to: '/community/leaderboard', label: 'Leaderboard', icon: Trophy },
  { to: '/community/profile', label: 'My profile', icon: UserRound },
  { to: '/community/blocks', label: 'Blocked', icon: Ban },
];

function PersonRoute() { const { username = '' } = useParams<{ username: string }>(); return <PersonPage key={username} username={username} />; }
function ThreadRoute() { const { username = '' } = useParams<{ username: string }>(); return <ThreadPage key={username} username={username} />; }

export default function SocialApp({ userId: _userId }: { userId: string }) {
  const [path] = useLocation();
  const qc = useQueryClient();
  const me = useGetSocialMe();
  useEffect(() => { refreshSocial(qc); }, [path, qc]);
  useEffect(() => { document.title = 'People — We Buggin'; return () => { document.title = 'We Buggin'; }; }, []);
  const needsIdentity = errStatus(me.error) === 409;
  return (
    <div className="beam-app sc">
      <div className="bm-bg" aria-hidden="true"><i /><i /><i /></div>
      <nav className="bm-nav">
        <Link href="/home" className="bm-logo"><span aria-hidden>🐞</span> WE BUGGIN</Link>
        <Link href="/home" className="bm-tag"><House size={12} /> Home</Link>
      </nav>
      <div className="sc-shell">
        <nav className="sc-nav" aria-label="Community">
          {NAV.map(({ to, label, icon: I, exact }) => {
            const on = exact ? path === to : path === to || path.startsWith(to + '/');
            return <Link key={to} href={to} className={`sc-nav-item${on ? ' is-on' : ''}`} aria-current={on ? 'page' : undefined} data-testid={`nav-${label.toLowerCase().replace(/\s/g, '-')}`}><I size={18} /><span>{label}</span></Link>;
          })}
        </nav>
        <main className="sc-main">
          {me.isLoading ? <Loading /> : needsIdentity ? (
            <div className="sc-empty"><h2>Claim your name first</h2><p>Community needs your account identity.</p><Link href="/user-portal" className="bm-btn bm-btn-primary">Set up identity</Link></div>
          ) : me.isError ? <ErrorBox error={me.error} retry={() => me.refetch()} /> : (
            <Switch>
              <Route path="/community" component={CommunityPage} />
              <Route path="/community/people/:username" component={PersonRoute} />
              <Route path="/community/profile" component={MyProfilePage} />
              <Route path="/community/favorites" component={FavoritesPage} />
              <Route path="/community/blocks" component={BlocksPage} />
              <Route path="/community/messages" component={InboxPage} />
              <Route path="/community/messages/:username" component={ThreadRoute} />
              <Route path="/community/rewards" component={RewardsPage} />
              <Route path="/community/leaderboard" component={LeaderboardPage} />
              <Route><div className="sc-empty"><h2>Not found</h2><Link href="/community" className="bm-btn">People</Link></div></Route>
            </Switch>
          )}
        </main>
      </div>
    </div>
  );
}
