import { useUser } from '@clerk/react';
import { Camera, Heart, House, MessageCircle, UserRound } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { GiftControl, OPEN_ROOM_GIFTS_EVENT } from '@/gifts';
import { GoLiveButton } from '@/chat/LiveStreamPages';
import { getGetSocialInboxQueryKey, useGetSocialInbox } from '@workspace/api-client-react';
import './bottom-navigation.css';

export function BottomNavigation() {
  const [path] = useLocation();
  const { isSignedIn } = useUser();
  const isUniversityRoom = path.startsWith('/rooms/');
  const isHome = path === '/home';
  const inbox = useGetSocialInbox({ query: { enabled: isHome && !!isSignedIn, queryKey: getGetSocialInboxQueryKey(), refetchInterval: 4_000, refetchOnWindowFocus: true } });
  const unreadCount = (inbox.data?.conversations ?? []).reduce((total, conversation) => total + Math.max(0, conversation.unreadCount || 0), 0);
  const protectedHref = (href: string) => isSignedIn ? href : '/sign-in';
  const items = [
    { label: 'Home', icon: House, href: isSignedIn ? '/home' : '/', active: path === '/' || path === '/home' || path.startsWith('/rooms/') || path === '/community' },
    { label: 'Following', icon: Heart, href: protectedHref('/community/favorites'), active: path === '/community/favorites' },
    { label: 'Message', icon: MessageCircle, href: protectedHref('/community/messages'), active: path === '/community/messages' || path.startsWith('/community/messages/') },
    { label: 'Me', icon: UserRound, href: protectedHref('/user-portal'), active: path === '/user-portal' || path.startsWith('/user-portal/') || path === '/community/profile' },
  ];
  return (
    <nav className="app-bottom-nav" aria-label="Main navigation">
      <div className={`app-bottom-nav-inner${isUniversityRoom ? ' has-room-gift' : ''}${isHome && isSignedIn ? ' has-home-live' : ''}`}>
        {items.slice(0, 2).map(({ label, icon: Icon, href, active }) => (
          <Link key={label} href={href} className={`app-bottom-link${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined} data-testid={`bottom-nav-${label.toLowerCase()}`}>
            <Icon size={26} strokeWidth={isHome && isSignedIn ? 3 : 2} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
        {isHome && isSignedIn && (
          <GoLiveButton className="app-home-live">
            <Camera size={22} strokeWidth={2.4} aria-hidden="true" />
            <span className="sr-only">Go live now</span>
          </GoLiveButton>
        )}
        {items.slice(2).map(({ label, icon: Icon, href, active }) => (
          <Link key={label} href={href} className={`app-bottom-link${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined} data-testid={`bottom-nav-${label.toLowerCase()}`}>
            <Icon size={26} strokeWidth={isHome && isSignedIn ? 3 : 2} aria-hidden="true" />
            {isHome && label === 'Message' && unreadCount > 0 && <b className="app-bottom-unread" aria-label={`${unreadCount} unread messages`} data-testid="badge-home-unread">{unreadCount > 99 ? '99+' : unreadCount}</b>}
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
