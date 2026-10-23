import { useEffect } from 'react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Users, Heart, Ban, Flag, MessageCircle, Coins, Trophy, UserRound } from 'lucide-react';
import { useGetChatAccess, useGetSocialMe } from '@workspace/api-client-react';
import '@/beam/beam.css';
import './social.css';
import { ErrorBox, Loading, errStatus, refreshSocial } from './common';
import { BlocksPage, CommunityPage, FavoritesPage, MyProfilePage, PersonPage } from './PeoplePages';
import { ModerationQueue } from '@/chat/ChatApp';
import { APP_NAME, Wordmark } from '@/components/brand';
import { BotProfile } from '@/profile/ProfileView';
import { BuyCreditsPage } from './BuyCreditsPage';
import { InboxPage } from './InboxPage';
import { LeaderboardPage, RewardsPage, ThreadPage } from './MoneyPages';
import { SafetyReportsPage } from '@/safety/SafetyReportsPage';
import { GiftStudioPage } from '@/gift-studio/GiftStudioPage';
import { ActionMenu } from '@/components/app-chrome';
import { ChessRoute } from '@/chess/ChessRoom';

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
      document.title = path === '/community/moderation' ? `Moderation — ${APP_NAME}`
        : path === '/community/reports' ? `Safety reports — ${APP_NAME}`
        : path === '/community/gift-studio' ? `Gift Studio — ${APP_NAME}`
        : isMessagesPath ? `Messages — ${APP_NAME}`
          : path === '/community/favorites' ? `Following — ${APP_NAME}`
            : `People — ${APP_NAME}`;
      return () => { document.title = APP_NAME; };
    }, [path]);
  const access = useGetChatAccess();
  const bare = path.startsWith('/community/people/') || path.startsWith('/community/bots/');
  const needsIdentity = errStatus(me.error) === 409;
  if (path.startsWith('/community/chess/')) {
    // Chess is a focused two-player surface: no community header, sidebars or global chrome.
    return me.isLoading ? <Loading /> : needsIdentity
      ? <div className="sc-empty"><h2>Claim your name first</h2><p>Chess needs your account identity.</p><Link href="/user-portal" className="bm-btn bm-btn-primary">Set up profile</Link></div>
      : <Switch><Route path="/community/chess/:chessRoomId" component={ChessRoute} /></Switch>;
  }
  return (
      <div className={`beam-app sc${bare ? ' sc-profile-screen' : ''}${isMessagesPath ? ' sc-inbox-screen' : path === '/community/favorites' ? ' sc-following-screen' : path === '/community/moderation' ? ' sc-moderation-screen' : path === '/community/reports' ? ' sc-reports-screen' : ''}`}>
      <div className="bm-bg" aria-hidden="true"><i /><i /><i /></div>
      {!bare && <nav className="bm-nav">
        <Wordmark href="/home" className="bm-logo" />
        <div className="sc-header-actions">
          <ActionMenu label="More pages" testId="menu-community-pages">
              {NAV.map(({ to, label, icon: I }) => (
                <Link key={to} href={to} onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
                  <I size={17} aria-hidden="true" /><span>{label}</span>
                </Link>
              ))}
              {access.data?.moderator && <Link href="/community/moderation" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}><Ban size={17} aria-hidden="true" /><span>Moderation</span></Link>}
              {access.data?.owner && <Link href="/community/reports" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}><Flag size={17} aria-hidden="true" /><span>Safety reports</span></Link>}
          </ActionMenu>
        </div>
      </nav>}
      <div className={`sc-shell${isMessagesPath || path === '/community/favorites' ? ' is-inbox' : ''}`}>
        {!bare && !isMessagesPath && path !== '/community/favorites' && <nav className="sc-nav" aria-label="Community">
          {NAV.map(({ to, label, icon: I, exact }) => {
            const on = exact ? path === to : path === to || path.startsWith(to + '/');
            return <Link key={to} href={to} className={`sc-nav-item${on ? ' is-on' : ''}`} aria-current={on ? 'page' : undefined} data-testid={`nav-${label.toLowerCase().replace(/\s/g, '-')}`}><I size={18} /><span>{label}</span></Link>;
          })}
          {access.data?.moderator && <Link href="/community/moderation" className={`sc-nav-item${path === '/community/moderation' ? ' is-on' : ''}`} data-testid="nav-moderation"><Ban size={18} /><span>Moderation</span></Link>}
          {access.data?.owner && <Link href="/community/reports" className={`sc-nav-item${path === '/community/reports' ? ' is-on' : ''}`} data-testid="nav-safety-reports"><Flag size={18} /><span>Reports</span></Link>}
        </nav>}
        <main className="sc-main">
          {access.data?.warning && <p className="sc-moderation-notice" role="alert">{access.data.warning}</p>}
          {(access.data?.chatMuted || access.data?.reportsMuted) && (
            <p className="sc-moderation-notice" role="status">Chat is temporarily muted while a moderator reviews reports.</p>
          )}
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
              <Route path="/community/reports">{() => access.data?.owner
                ? <SafetyReportsPage />
                : <div className="sc-empty" role="status" data-testid="status-reports-access"><h2>Owner access required</h2><p>Safety reports are private to the Deux Wild owner.</p><Link href="/community" className="bm-btn">Back to People</Link></div>}</Route>
              <Route path="/community/gift-studio">{() => access.data?.owner
                ? <GiftStudioPage />
                : access.isLoading
                  ? <Loading />
                  : <div className="sc-empty" role="status" data-testid="status-gift-studio-access"><h2>Owner access required</h2><p>Gift Studio is available only to the Deux Wild owner.</p><Link href="/community/profile" className="bm-btn">Back to Me</Link></div>}</Route>
              <Route path="/community/rewards"><RewardsPage /></Route>
              <Route path="/community/coins" component={BuyCreditsPage} />
              {/* Keep the old address working for saved links; new links use /coins. */}
              <Route path="/community/credits" component={BuyCreditsPage} />
              <Route path="/community/leaderboard" component={LeaderboardPage} />
              <Route path="/community/chess/:chessRoomId" component={ChessRoute} />
              <Route><div className="sc-empty"><h2>Not found</h2><Link href="/community" className="bm-btn">People</Link></div></Route>
            </Switch>
          )}
        </main>
      </div>
    </div>
  );
}
