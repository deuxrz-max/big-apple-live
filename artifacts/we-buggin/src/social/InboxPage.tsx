import { ScreenHeader } from '@/components/app-chrome';
import { useMemo } from 'react';
import { Link } from 'wouter';
import {
  useGetSocialInbox, useGetFavoritesGallery,
  getGetSocialInboxQueryKey, getGetFavoritesGalleryQueryKey,
} from '@workspace/api-client-react';
import { Avatar, Empty, ErrorBox } from './common';
import { ShinyName } from '@/components/ShinyName';
import { GameGem } from '@/components/game-gem';
import './inbox.css';

function stamp(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

const href = (u: string) => `/community/messages/${encodeURIComponent(u)}`;

export function InboxPage() {
  const q = useGetSocialInbox({ query: { queryKey: getGetSocialInboxQueryKey(), refetchInterval: 4000 } });
  const fav = useGetFavoritesGallery({ query: { queryKey: getGetFavoritesGalleryQueryKey(), refetchInterval: 15000, refetchOnWindowFocus: true } });
  const convos = useMemo(() => [...(q.data?.conversations ?? [])].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [q.data]);
  const live = useMemo(() => {
    const inRoom = new Set((fav.data ?? []).filter((e) => e.room != null).map((e) => e.person.username));
    return convos
      .filter((c) => c.unreadCount > 0 && !c.blocked && inRoom.has(c.username))
      .sort((a, b) => Date.parse(b.lastUnreadAt ?? '') - Date.parse(a.lastUnreadAt ?? '') || 0);
  }, [convos, fav.data]);

  return (
    <section className="ib">
      <ScreenHeader className="ib-bar" backHref="/home" backLabel="Back to home" title={<><GameGem color="blue" size={26} /> Messages</>} testId="header-inbox"
        subtitle={q.data ? `${q.data.conversations.length} conversation${q.data.conversations.length === 1 ? '' : 's'}` : undefined} />
      {q.isLoading && <div className="sc-skel" role="status" aria-label="Loading"><i /><i /><i /></div>}
      {q.isError && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.data && !q.isError && !fav.isError && live.length > 0 && (
        <ul className="ib-live" aria-label="Active now with unread messages">
          {live.map((c) => (
            <li key={c.username}>
              <div className="ib-live-item" data-testid={`item-active-${c.username}`}>
                <span className="ib-ph">
                  <Avatar p={{ username: c.username, displayName: c.displayName, photoUrl: c.photoUrl }} size={64} />
                  <i className="ib-dot" aria-hidden="true" />
                  <b className="ib-count">{c.unreadCount}</b>
                </span>
                <Link href={href(c.username)} className="dw-link-contents" aria-label={`${c.displayName || c.username}, active now, ${c.unreadCount} unread`} data-testid={`link-active-${c.username}`}>
                  <ShinyName className="ib-live-name" displayNameColor={c.displayNameColor} displayNameTierIndex={c.displayNameTierIndex}>{c.displayName || c.username}</ShinyName>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      {q.data && (convos.length === 0
        ? <Empty title="No messages yet"><p>Open someone's profile to say hello.</p><Link href="/community" className="bm-btn">Find people</Link></Empty>
        : <ul className="ib-list">{convos.map((c) => {
          const unread = c.unreadCount > 0;
          return (
            <li key={c.username}>
              <div className={`ib-row${unread ? ' is-unread' : ''}`} data-testid={`row-conversation-${c.username}`}>
                <span className="ib-avatar">
                  <Avatar p={{ username: c.username, displayName: c.displayName, photoUrl: c.photoUrl }} size={52} />
                </span>
                <Link href={href(c.username)} className="dw-link-contents" data-testid={`link-conversation-${c.username}`}>
                <span className="ib-mid">
                  <span className="ib-heading">
                    <span className="ib-name">
                      <ShinyName className="ib-name-text" displayNameColor={c.displayNameColor} displayNameTierIndex={c.displayNameTierIndex}>{c.displayName?.trim() || c.username}</ShinyName>
                      {c.blocked && <em className="ib-blocked">Blocked</em>}
                    </span>
                  </span>
                  <span className="ib-prev">{c.lastMessageFromMe ? 'You: ' : ''}{c.lastMessage}</span>
                </span>
                <span className="ib-side">
                  <time className="ib-time" dateTime={c.updatedAt}>{stamp(c.updatedAt)}</time>
                  {unread && <b className="ib-count ib-count-row" aria-label={`${c.unreadCount} unread`}>{c.unreadCount}</b>}
                </span>
                </Link>
              </div>
            </li>
          );
        })}</ul>)}
    </section>
  );
}
