import { useEffect } from 'react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Users, Heart, Ban, MessageCircle, Coins, Trophy, UserRound, House, Stamp, EllipsisVertical } from 'lucide-react';
import { useGetChatAccess, useGetSocialMe } from '@workspace/api-client-react';
import '@/beam/beam.css';
import './social.css';
import { ErrorBox, Loading, errStatus, refreshSocial } from './common';
import { BlocksPage, CommunityPage, FavoritesPage, MyProfilePage, PersonPage } from './PeoplePages';
import { ModerationQueue } from '@/chat/ChatApp';
import { Wordmark } from '@/components/brand';
import { BotProfile } from '@/profile/ProfileView';
import { BuyCreditsPage } from './BuyCreditsPage';
import { InboxPage } from './InboxPage';
import { LeaderboardPage, RewardsPage, ThreadPage } from './MoneyPages';
import { StreamerPassportReview } from '@/passport/StreamerPassport';

const NAV = [
  { to: '/community', label: 'People', icon: Users, exact: true },
  { to: '/community/favorites', label: 'Following', icon: Heart },
  { to: '/community/messages', label: 'Messages', icon: MessageCircle },
  { to: '/community/rewards', label: 'Rewards', icon: Coins },
  { to: '/community/leaderboard', label: 'Leaderboard', icon: Trophy },
  { to: '/community/profile', label: 'My profile', icon: UserRound },
  { to: '/community/blocks', label: 'Blocked', icon: Ban },
];

function BotRoute() { const { botId = '' } = useParams<{ botId: string }>(); return <BotProfile botId={botId} />; }
function PersonRoute() { const { username = '' } = useParams<{ username: string }>(); return <PersonPage key={username} username={username} />; }
function ThreadRoute() { const { username = '' } = useParams<{ username: string }>(); return <ThreadPage key={username} username={username} />; }

export default function SocialApp({ userId: _userId }: { userId: string }) {
  const [path] = useLocation();
  const isMessagesPath = path === '/community/messages' || path.startsWith('/community/messages/');
  const qc = useQueryClient();
  const me = useGetSocialMe();
  useEffect(() => { refreshSocial(qc); }, [path, qc]);
    useEffect(() => {
      document.title = path === '/community/moderation' ? 'Moderation — Streamtalk'
        : path === '/community/messages' ? 'Messages — Streamtalk'
          : path === '/community/favorites' ? 'Following — Streamtalk'
            : 'People — Streamtalk';
      return () => { document.title = 'Streamtalk'; };
    }, [path]);
  const access = useGetChatAccess();
  const bare = path.startsWith('/community/people/') || path.startsWith('/community/bots/');
  const needsIdentity = errStatus(me.error) === 409;
  return (
      <div className={`beam-app sc${bare ? ' sc-profile-screen' : ''}${path === '/community/messages' ? ' sc-inbox-screen' : path === '/community/favorites' ? ' sc-following-screen' : path === '/community/moderation' ? ' sc-moderation-screen' : ''}`}>
      <div className="bm-bg" aria-hidden="true"><i /><i /><i /></div>
      {!bare && <nav className="bm-nav">
        <Wordmark href="/home" className="bm-logo" />
        <div className="sc-header-actions">
          <Link href="/home" className="sc-header-home" aria-label="Home">
            <House size={21} aria-hidden="true" />
            <span>Home</span>
          </Link>
          <details className="sc-more-menu">
            <summary aria-label="More pages" title="More pages"><EllipsisVertical size={21} aria-hidden="true" /></summary>
            <nav aria-label="More pages">
              {NAV.map(({ to, label, icon: I }) => (
                <Link key={to} href={to} onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
                  <I size={17} aria-hidden="true" /><span>{label}</span>
                </Link>
              ))}
              {access.data?.moderator && <Link href="/community/moderation" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}><Ban size={17} aria-hidden="true" /><span>Moderation</span></Link>}
              {access.data?.moderator && <Link href="/community/passport-review" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}><Stamp size={17} aria-hidden="true" /><span>Passport review</span></Link>}
            </nav>
          </details>
        </div>
      </nav>}
      <div className={`sc-shell${isMessagesPath || path === '/community/favorites' ? ' is-inbox' : ''}`}>
        {!bare && !isMessagesPath && path !== '/community/favorites' && <nav className="sc-nav" aria-label="Community">
          {NAV.map(({ to, label, icon: I, exact }) => {
            const on = exact ? path === to : path === to || path.startsWith(to + '/');
            return <Link key={to} href={to} className={`sc-nav-item${on ? ' is-on' : ''}`} aria-current={on ? 'page' : undefined} data-testid={`nav-${label.toLowerCase().replace(/\s/g, '-')}`}><I size={18} /><span>{label}</span></Link>;
          })}
          {access.data?.moderator && <Link href="/community/moderation" className={`sc-nav-item${path === '/community/moderation' ? ' is-on' : ''}`} data-testid="nav-moderation"><Ban size={18} /><span>Moderation</span></Link>}
          {access.data?.moderator && <Link href="/community/passport-review" className={`sc-nav-item${path === '/community/passport-review' ? ' is-on' : ''}`} data-testid="nav-passport-review"><Stamp size={18} /><span>Passport review</span></Link>}
        </nav>}
        <main className="sc-main">
          {me.isLoading ? <Loading /> : needsIdentity ? (
            <div className="sc-empty"><h2>Claim your name first</h2><p>Community needs your account identity.</p><Link href="/user-portal" className="bm-btn bm-btn-primary">Set up profile</Link></div>
          ) : me.isError ? <ErrorBox error={me.error} retry={() => me.refetch()} /> : (
            <Switch>
              <Route path="/community" component={CommunityPage} />
              <Route path="/community/people/:username" component={PersonRoute} />
              <Route path="/community/bots/:botId" component={BotRoute} />
              <Route path="/community/profile" component={MyProfilePage} />
              <Route path="/community/favorites" component={FavoritesPage} />
              <Route path="/community/blocks" component={BlocksPage} />
              <Route path="/community/messages" component={InboxPage} />
              <Route path="/community/messages/:username" component={ThreadRoute} />
              <Route path="/community/moderation" component={ModerationQueue} />
              <Route path="/community/passport-review">{() => access.data?.moderator
                ? <StreamerPassportReview />
                : <div className="sc-empty" role="status" data-testid="status-passport-review-access"><h2>Moderator access required</h2><p>This review desk is limited to authorized moderators.</p><Link href="/community" className="bm-btn">Back to People</Link></div>}</Route>
              <Route path="/community/rewards"><RewardsPage /></Route>
              <Route path="/community/credits" component={BuyCreditsPage} />
              <Route path="/community/leaderboard" component={LeaderboardPage} />
              <Route><div className="sc-empty"><h2>Not found</h2><Link href="/community" className="bm-btn">People</Link></div></Route>
            </Switch>
          )}
        </main>
      </div>
    </div>
  );
}
