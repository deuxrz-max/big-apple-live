import { useUser } from '@clerk/react';
import type { ReactNode } from 'react';
import { Camera, Heart, House, MessageCircle, UserRound } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { GiftControl, OPEN_ROOM_GIFTS_EVENT } from '@/gifts';
import { GoLiveButton } from '@/chat/LiveStreamPages';
import { getGetSocialInboxQueryKey, useGetSocialInbox } from '@workspace/api-client-react';
import './bottom-navigation.css';

export function BottomNavigation() {
  const [path] = useLocation();
  const { isSignedIn } = useUser();
  const hidden = path.startsWith('/community/chess/');
  const inbox = useGetSocialInbox({ query: { enabled: !!isSignedIn && !hidden, queryKey: getGetSocialInboxQueryKey(), refetchInterval: 4_000, refetchOnWindowFocus: true, refetchOnReconnect: 'always', staleTime: 0 } });
  const unreadCount = (inbox.data?.conversations ?? []).reduce((total, conversation) => total + Math.max(0, conversation.unreadCount || 0), 0);
  return <BottomNavigationContent path={path} isSignedIn={!!isSignedIn} unreadCount={unreadCount}
    homeLiveControl={path === '/home' && isSignedIn ? (
      <GoLiveButton className="app-home-live">
        <Camera size={22} strokeWidth={2.4} aria-hidden="true" />
        <span className="sr-only">Go live now</span>
      </GoLiveButton>
    ) : null} />;
}

export function BottomNavigationContent({ path, isSignedIn, unreadCount, homeLiveControl }: {
  path: string; isSignedIn: boolean; unreadCount: number; homeLiveControl?: ReactNode;
}) {
  const isUniversityRoom = path.startsWith('/rooms/');
  const isHome = path === '/home';
  const hidden = path.startsWith('/community/chess/');
  const protectedHref = (href: string) => isSignedIn ? href : '/sign-in';
  const items = [
    { label: 'Home', icon: House, href: isSignedIn ? '/home' : '/', active: path === '/' || path === '/home' || path.startsWith('/rooms/') || path === '/community' },
    { label: 'Following', icon: Heart, href: protectedHref('/community/favorites'), active: path === '/community/favorites' },
    { label: 'Message', icon: MessageCircle, href: protectedHref('/community/messages'), active: path === '/community/messages' || path.startsWith('/community/messages/') },
    { label: 'Me', icon: UserRound, href: protectedHref('/user-portal'), active: path === '/user-portal' || path.startsWith('/user-portal/') || path === '/community/profile' },
  ];
  if (hidden) return null;
  return (
    <nav className="app-bottom-nav" aria-label="Main navigation">
      <div className={`app-bottom-nav-inner${isUniversityRoom ? ' has-room-gift' : ''}${isHome && isSignedIn ? ' has-home-live' : ''}`}>
        {items.slice(0, 2).map(({ label, icon: Icon, href, active }) => (
          <Link key={label} href={href} className={`app-bottom-link${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined} data-testid={`bottom-nav-${label.toLowerCase()}`}>
            <i className="app-bottom-pip" aria-hidden="true" />
            <Icon size={22} strokeWidth={2.1} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
        {isHome && isSignedIn && homeLiveControl}
        {items.slice(2).map(({ label, icon: Icon, href, active }) => (
          <Link key={label} href={href} className={`app-bottom-link${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined} data-testid={`bottom-nav-${label.toLowerCase()}`}>
            <i className="app-bottom-pip" aria-hidden="true" />
            <Icon size={22} strokeWidth={2.1} aria-hidden="true" />
            {isSignedIn && label === 'Message' && unreadCount > 0 && <b className="app-bottom-unread" aria-label={`${unreadCount} unread messages`} data-testid="badge-home-unread">{unreadCount > 99 ? '99+' : unreadCount}</b>}
            <span>{label}</span>
          </Link>
        ))}
        {isUniversityRoom && (
          <GiftControl
            label="Open room gifts"
            onClick={() => window.dispatchEvent(new Event(OPEN_ROOM_GIFTS_EVENT))}
          />
        )}
      </div>
    </nav>
  );
}
