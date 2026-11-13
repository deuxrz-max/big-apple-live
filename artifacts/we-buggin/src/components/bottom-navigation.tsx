import { useUser } from '@clerk/react';
import type { ReactNode } from 'react';
import { Heart, House, MessageCircle, UserRound } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { getGetSocialInboxQueryKey, useGetSocialInbox } from '@workspace/api-client-react';
import './bottom-navigation.css';

export function BottomNavigation() {
  const [path] = useLocation();
  const { isSignedIn } = useUser();
  const isBattleScreen = path === '/battle';
  const inbox = useGetSocialInbox({ query: { enabled: !!isSignedIn && !isBattleScreen, queryKey: getGetSocialInboxQueryKey(), refetchInterval: 4_000, refetchOnWindowFocus: true, refetchOnReconnect: 'always', staleTime: 0 } });
  const unreadCount = (inbox.data?.conversations ?? []).reduce((total, conversation) => total + Math.max(0, conversation.unreadCount || 0), 0);
  if (isBattleScreen) return null;
  return <BottomNavigationContent path={path} isSignedIn={!!isSignedIn} unreadCount={unreadCount} />;
}

export function BottomNavigationContent({ path, isSignedIn, unreadCount }: {
  path: string; isSignedIn: boolean; unreadCount: number;
}) {
  const isHome = path === '/home';
  const protectedHref = (href: string) => isSignedIn ? href : '/sign-in';
  const items = [
    { label: 'Home', icon: House, href: isSignedIn ? '/home' : '/', active: path === '/' || path === '/home' || path.startsWith('/rooms/') || path === '/community' },
    { label: 'Following', icon: Heart, href: protectedHref('/community/favorites'), active: path === '/community/favorites' },
    { label: 'Message', icon: MessageCircle, href: protectedHref('/community/messages'), active: path === '/community/messages' || path.startsWith('/community/messages/') },
    { label: 'Me', icon: UserRound, href: protectedHref('/user-portal'), active: path === '/user-portal' || path.startsWith('/user-portal/') || path === '/community/profile' },
  ];
  return (
    <nav className="app-bottom-nav" aria-label="Main navigation">
      <div className={`${isHome && isSignedIn ? 'app-bottom-nav-inner has-home-live' : 'app-bottom-nav-inner'}`}>
        {items.slice(0, 2).map(({ label, icon: Icon, href, active }) => (
          <Link key={label} href={href} className={`app-bottom-link${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined} data-testid={`bottom-nav-${label.toLowerCase()}`}>
            <i className="app-bottom-pip" aria-hidden="true" />
            <Icon size={22} strokeWidth={2.1} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
        {items.slice(2).map(({ label, icon: Icon, href, active }) => (
          <Link key={label} href={href} className={`app-bottom-link${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined} data-testid={`bottom-nav-${label.toLowerCase()}`}>
            <i className="app-bottom-pip" aria-hidden="true" />
            <Icon size={22} strokeWidth={2.1} aria-hidden="true" />
            {isSignedIn && label === 'Message' && unreadCount > 0 && <b className="app-bottom-unread" aria-label={`${unreadCount} unread messages`} data-testid="badge-home-unread">{unreadCount > 99 ? '99+' : unreadCount}</b>}
            <span>{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
