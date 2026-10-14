import '@/beam/beam.css';
import '@/social/social.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetChatAccessQueryKey, getGetMyProfileQueryKey, getGetSocialMeQueryKey,
  useConfirmChatAdult, useGetChatAccess, useGetChatDirectory,
  useGetChatReports, useGetMyProfile, useGetSocialMe, useEquipMyBadge, useReviewChatReport, useSaveMyProfile,
  getGetChatReportsQueryKey, getGetChatDirectoryQueryKey, ChatReportReviewInputAction,
} from '@workspace/api-client-react';
import { UserPhoto } from '@/components/user-photo';
import { Wordmark } from '@/components/brand';
import { errMessage } from '@/lib/errors';
import { PhotoReviewQueue } from './PhotoReviewQueue';
import { BotModerationPanel } from './BotModerationPanel';
import { BadgeArt } from '@/social/BadgeArt';
import './chat.css';

const DISCLAIMER = 'Streamtalk is independent and is not affiliated with, endorsed by, or sponsored by any platform named here.';

function Shell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`ch ${className}`.trim()}><div className="ch-in">{children}</div></div>;
}

function Cover({ roomId, i }: { roomId: string; i: number }) {
  const [bad, setBad] = useState(false);
  const coverPath = roomId === 'HIST01' || roomId === 'WEBSER'
    ? `university-covers/${encodeURIComponent(roomId)}.svg`
    : `university-covers/${encodeURIComponent(roomId)}.webp`;
  return (
    <div className={`st-cover st-cover-${i % 6}${bad ? ' is-fallback' : ''}`}>
      {!bad && <img src={`${import.meta.env.BASE_URL}${coverPath}`} alt=""
        loading={roomId === 'HIST01' || roomId === 'WEBSER' ? 'eager' : 'lazy'} onError={() => setBad(true)} />}
    </div>
  );
}

function UniCard({ roomId, label, headcount, i, preview }: { roomId: string; label: string; headcount: number; i: number; preview?: boolean }) {
  const count = typeof headcount === 'number' ? headcount : null;
  const inner = (
    <>
      <Cover roomId={roomId} i={i} />
      <span className="st-live">Live</span>
      <span className="st-count" role="status" aria-label={count !== null ? `${count} people here` : 'Loading headcount'}>{count !== null ? count : 'Loading…'}</span>
      <div className="st-card-body">
        <strong title={label}>{label}</strong>
        <span className="st-enter">Enter</span>
      </div>
    </>
  );
  return (
    <li key={roomId} className="st-card" data-testid={`row-room-${roomId}`}>
      <Link href={preview ? '/sign-in' : `/rooms/${encodeURIComponent(roomId)}`} className="st-card-link" aria-label={`Enter ${label}`}>{inner}</Link>
    </li>
  );
}

function List({ preview, query = '' }: { preview?: boolean; query?: string }) {
  const q = useGetChatDirectory({ query: { queryKey: getGetChatDirectoryQueryKey(), refetchInterval: 15_000 } });
  const needle = query.trim().toLowerCase();
  const rows = (q.data ?? []).filter((r) => !needle || r.label.toLowerCase().includes(needle));
  return (
    <>
      {q.isLoading && <p role="status">Loading directory...</p>}
      {q.isError && <div className="ch-err" role="alert">{preview ? 'Sign in to see the directory.' : 'Could not load the directory.'} {!preview && <button type="button" className="bm-btn bm-btn-sm" onClick={() => q.refetch()}>Retry</button>}</div>}
      {q.data && q.data.length === 0 && <p>No entries.</p>}
      {q.data && q.data.length > 0 && rows.length === 0 && <p>No university matches your search.</p>}
      <ul className="ch-list st-grid">
        {rows.map((r) => <UniCard key={r.roomId} roomId={r.roomId} label={r.label} headcount={r.headcount} i={(q.data ?? []).findIndex((entry) => entry.roomId === r.roomId)} preview={preview} />)}
      </ul>
    </>
  );
}

function CreditsChip() {
  const me = useGetSocialMe();
  if (!me.data) return null;
  return <Link href="/community/rewards" className="st-credits" data-testid="text-credits">
    {me.data.wallet.unlimited ? 'Unlimited test credits' : `${me.data.wallet.balance.toLocaleString()} credits`}
  </Link>;
}

function TopBar({ signedIn, query, setQuery }: { signedIn: boolean; query: string; setQuery: (v: string) => void }) {
  return (
    <div className="st-topbar">
      <Wordmark href={signedIn ? '/home' : '/'} className="st-brand" />
      <input type="search" className="st-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search universities" />
      {signedIn ? <CreditsChip /> : <Link href="/sign-in" className="bm-btn bm-btn-sm bm-btn-primary">Sign in</Link>}
    </div>
  );
}

export function PublicChatLanding() {
  const [query, setQuery] = useState('');
  return (
    <Shell>
      <TopBar signedIn={false} query={query} setQuery={setQuery} />
      <h1>Streamtalk</h1>
      <p>Text chat universities. One account works in any university. Universities are listed by platform label.</p>
      <List preview query={query} />
      <p className="ch-note">{DISCLAIMER}</p>
      <p><Link href="/sign-in" className="bm-btn bm-btn-primary">Sign in</Link> <Link href="/sign-up" className="bm-btn">Create account</Link></p>
    </Shell>
  );
}

export function AdultGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useGetChatAccess();
  const confirm = useConfirmChatAdult();
  const [ok, setOk] = useState(false);
  if (q.isLoading) return <Shell><p role="status">Checking access...</p></Shell>;
  if (q.isError || !q.data) return <Shell><div className="ch-err" role="alert">Could not check access. <button type="button" className="bm-btn bm-btn-sm" onClick={() => q.refetch()}>Retry</button></div></Shell>;
  if (q.data.suspended) return <Shell><h1>Chat access restricted</h1><p>Your access requires review by a Streamtalk moderator. A new age confirmation cannot remove this restriction.</p><Link href="/" className="bm-btn">Home</Link></Shell>;
  if (q.data.adultConfirmed) return <>{children}</>;
  return (
    <Shell>
      <h1>Adults only</h1>
      <p>These pages are for people aged 18 or over. This is a self-declared statement; your age is not verified.</p>
      <label><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} data-testid="checkbox-adult" /> I confirm I am 18 or older.</label>
      {confirm.isError && <div className="ch-err" role="alert">{errMessage(confirm.error)}</div>}
      <p><button type="button" className="bm-btn bm-btn-primary" disabled={!ok || confirm.isPending} data-testid="button-confirm-adult"
        onClick={() => confirm.mutate({ data: { adult: true } }, { onSuccess: (a) => qc.setQueryData(getGetChatAccessQueryKey(), a) })}>{confirm.isPending ? 'Saving...' : 'Continue'}</button></p>
      <p className="ch-note">{DISCLAIMER}</p>
    </Shell>
  );
}

export function ChatDirectory() {
  const { signOut } = useClerk();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const directory = useGetChatDirectory({ query: { queryKey: getGetChatDirectoryQueryKey(), refetchInterval: 15_000 } });
  const me = useGetMyProfile({ query: { queryKey: getGetMyProfileQueryKey(), refetchInterval: 60_000 } });
  const topics = ['Music', 'Movies', 'Sports', 'Pro Wrestling', 'Web Series', 'History', 'News'];
  type DirectoryRoom = { roomId: string; label: string; headcount: number; nowPlayingVideoId?: string | null; nowPlayingTitle?: string | null };
  const rooms = (directory.data ?? []) as DirectoryRoom[];
  const topicFor = (room: DirectoryRoom) => {
    const source = `${room.label} ${room.roomId}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    return topics.find((topic) => source.includes(topic.toLowerCase())) ?? room.label;
  };
  const searched = rooms.filter((room) => `${room.label} ${topicFor(room)} ${room.nowPlayingTitle ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visible = searched.filter((room) => {
    if (filter === 'Live Now') return room.headcount > 0;
    if (filter === 'Popular') return true;
    return filter === 'All' || topicFor(room) === filter;
  }).sort((a, b) => filter === 'Popular' ? b.headcount - a.headcount : 0);
  const featured = rooms.length ? [...rooms].sort((a, b) => b.headcount - a.headcount)[0] : undefined;
  const activeRoomCount = rooms.filter((room) => room.headcount > 0).length;
  return (
    <Shell className="st-directory">
      <header className="st-dir-header">
        <div className="st-dir-topline">
          <div className="st-dir-lockup">
            <Wordmark href="/home" className="st-brand" />
            <span className="st-dir-livehub">LIVE HUB</span>
          </div>
          <div className="st-dir-account">
            <span className="st-dir-unlimited">Unlimited</span>
            <Link href="/user-portal" className="st-dir-avatar" aria-label={`Profile${me.data?.profile?.username ? `: ${me.data.profile.username}` : ''}`}>
              <UserPhoto username={me.data?.profile?.username} displayName={me.data?.profile?.displayName} photoUrl={me.data?.profile?.photoUrl} size={38} />
              <i aria-hidden="true" />
            </Link>
            <details className="st-dir-menu">
              <summary aria-label="Open account menu">⋯</summary>
              <button type="button" onClick={() => signOut({ redirectUrl: import.meta.env.BASE_URL || '/' })}>Sign out</button>
            </details>
          </div>
        </div>
        <label className="st-dir-search-wrap">
          <span className="st-dir-search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.5" /><path d="m16 16 4.2 4.2" /></svg>
          </span>
          <input type="search" className="st-search st-dir-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search channels, topics, streams…" aria-label="Search channels, topics and streams" />
          {query && <button type="button" className="st-dir-clear" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
        </label>
      </header>

      <section className="st-dir-intro" aria-labelledby="st-dir-title">
        <div className="st-dir-kicker"><span className="st-dir-kicker-dot" /> THE CONVERSATION IS LIVE</div>
        <h1 id="st-dir-title">Find your <em>room.</em></h1>
        <p>Drop into what you love. The best conversations happen in real time.</p>
      </section>

      {!directory.isLoading && !directory.isError && featured && (
        <section className="st-dir-feature" aria-label="Most occupied room">
          <div className="st-dir-section-head">
              <div><span className="st-dir-overline">FEATURED LIVE</span><h2>The room everyone's heading to tonight</h2></div>
              <a className="st-dir-feature-mark" href="#live-channels">All rooms →</a>
          </div>
            <DirectoryRoomCard room={featured} topic={topicFor(featured)} featured />
        </section>
      )}

      <section className="st-dir-explore" id="live-channels" aria-labelledby="st-dir-explore-title">
        <div className="st-dir-section-head st-dir-explore-heading">
          <div><span className="st-dir-overline">LIVE CHANNELS</span><h2 id="st-dir-explore-title">Find your next room</h2></div>
          {!directory.isLoading && !directory.isError && <span className="st-dir-total">{activeRoomCount} Active {activeRoomCount === 1 ? 'Room' : 'Rooms'}</span>}
        </div>
        <div className="st-dir-filters" role="group" aria-label="Filter rooms">
          {['All', 'Live Now', 'Popular', ...topics].map((item) => (
            <button key={item} type="button" className={`st-dir-filter${filter === item ? ' is-active' : ''}`} aria-pressed={filter === item} onClick={() => setFilter(item)}>
              {item === 'Live Now' && <span className="st-dir-filter-dot" aria-hidden="true" />}{item}
            </button>
          ))}
        </div>

        {directory.isLoading && <ul className="st-dir-grid" aria-label="Loading rooms" aria-busy="true">{[0, 1, 2, 3].map((n) => <li className="st-dir-skeleton" key={n}><span /><div><i /><i /></div></li>)}</ul>}
        {directory.isError && <div className="st-dir-state st-dir-error" role="alert"><div className="st-dir-state-mark">!</div><h3>Rooms aren’t loading</h3><p>We couldn’t reach the directory. Give it another try.</p><button type="button" onClick={() => directory.refetch()}>Retry directory</button></div>}
        {directory.data && rooms.length === 0 && <div className="st-dir-state"><div className="st-dir-state-mark">—</div><h3>Quiet for a moment</h3><p>There are no rooms in the directory right now. Check back soon.</p></div>}
        {directory.data && rooms.length > 0 && visible.length === 0 && <div className="st-dir-state"><div className="st-dir-state-mark">⌕</div><h3>No rooms found</h3><p>Try another search or switch to a different topic.</p><button type="button" onClick={() => { setQuery(''); setFilter('All'); }}>Clear filters</button></div>}
        {directory.data && visible.length > 0 && <ul className="st-dir-grid">
          {visible.map((room) => <li key={room.roomId}><DirectoryRoomCard room={room} topic={topicFor(room)} /></li>)}
        </ul>}
      </section>
      <footer className="st-dir-footer"><span>STREAMTALK · FIND YOUR PEOPLE</span><p>{DISCLAIMER}</p></footer>
    </Shell>
  );
}

function DirectoryRoomCard({ room, topic, featured = false }: {
  room: { roomId: string; label: string; headcount: number; nowPlayingVideoId?: string | null; nowPlayingTitle?: string | null };
  topic: string;
  featured?: boolean;
}) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [topicPhotoFailed, setTopicPhotoFailed] = useState(false);
  const videoId = room.nowPlayingVideoId;
  const hasThumbnail = !!videoId && !thumbnailFailed;
  const hasTopicPhoto = !hasThumbnail && !topicPhotoFailed;
  const displayTitle = room.nowPlayingTitle?.trim();
  return (
    <Link href={`/rooms/${encodeURIComponent(room.roomId)}`} className={`st-dir-card${featured ? ' is-featured' : ''}`} aria-label={`Enter ${room.label}, ${room.headcount} ${room.headcount === 1 ? 'person' : 'people'} here`}>
      <div className={`st-dir-art st-dir-art-${topicClass(topic)}${hasThumbnail ? ' has-video' : ''}`}>
        {hasThumbnail
          ? <img src={`https://img.youtube.com/vi/${encodeURIComponent(videoId!)}/hqdefault.jpg`} alt="" loading={featured ? 'eager' : 'lazy'} onError={() => setThumbnailFailed(true)} />
          : hasTopicPhoto
            ? <img className="st-dir-topic-photo" src={topicPhotoUrl(topic)} alt="" loading={featured ? 'eager' : 'lazy'} onError={() => setTopicPhotoFailed(true)} />
            : <div className="st-dir-art-fallback" aria-hidden="true"><span className="st-dir-art-index">{topicInitial(topic)}</span><span className="st-dir-art-word">{topic.toUpperCase()}</span><span className="st-dir-art-lines" /></div>}
        <span className={`st-dir-live${room.headcount > 0 ? ' is-live' : ''}`}><i />{room.headcount > 0 ? 'LIVE NOW' : 'OPEN ROOM'}</span>
        <span className="st-dir-count"><b aria-hidden="true">◉</b><span>{room.headcount} watching</span></span>
        <span className="st-dir-video-tag">{displayTitle || `${topic} community`}</span>
        <span className="st-dir-art-shade" />
        {featured && (
          <span className="st-dir-featured-copy">
            <span className="st-dir-featured-title">{room.label}</span>
            <span className="st-dir-featured-description">{topicDescription(topic)}</span>
            <span className="st-dir-featured-meta">
              <span className="st-dir-topic-avatar" aria-hidden="true">{topicInitial(topic)}</span>
              <span>Community in {topic}</span>
              <span className="st-dir-featured-enter">Enter room</span>
            </span>
          </span>
        )}
      </div>
      {!featured && <div className="st-dir-card-copy">
        <div className="st-dir-card-titles"><h3>{room.label}</h3><p>{displayTitle || topicDescription(topic)}</p></div>
        <span className="st-dir-enter" aria-hidden="true">▶ Enter</span>
      </div>}
    </Link>
  );
}

function topicDescription(topic: string) {
  const descriptions: Record<string, string> = {
    Music: 'Live sets, new releases and late-night listening.',
    Movies: 'Trailers, film talk and box-office picks.',
    Sports: 'Highlights, big games and fan conversation.',
    'Pro Wrestling': 'Promos, matches and wrestling talk.',
    'Web Series': 'Today’s series, episode by episode.',
    History: 'Documentaries and stories from the past.',
    News: 'Live headlines and current events.',
  };
  return descriptions[topic] ?? `Live conversation about ${topic}.`;
}

function topicClass(topic: string) {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function topicInitial(topic: string) {
  const initials: Record<string, string> = { 'Pro Wrestling': 'PW', 'Web Series': 'WS' };
  return initials[topic] ?? topic.slice(0, 1).toUpperCase();
}

function topicPhotoUrl(topic: string) {
  const photoIds: Record<string, string> = {
    Music: 'photo-1492684223066-81342ee5ff30',
    Movies: 'photo-1489599849927-2ee91cede3ba',
    Sports: 'photo-1508098682722-e99c43a406b2',
    'Pro Wrestling': 'photo-1540747913346-19e32dc3e97e',
    'Web Series': 'photo-1485846234645-a62644f84728',
    History: 'photo-1461360370896-922624d12aa1',
    News: 'photo-1504711434969-e33886168f5c',
  };
  const id = photoIds[topic];
  return id ? `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=72` : '';
}

const invalidateSocial = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/api/social') });

export function ProfileGate({ children }: { children: ReactNode }) {
  return (
    <AdultGate>
      <ProfileGateInner>{children}</ProfileGateInner>
    </AdultGate>
  );
}

function ProfileGateInner({ children }: { children: ReactNode }) {
  const q = useGetMyProfile({ query: { queryKey: getGetMyProfileQueryKey(), refetchInterval: 15_000 } });
  if (q.isLoading) return <Shell><p role="status">Loading your profile...</p></Shell>;
  if (q.isError) return <Shell><div className="ch-err" role="alert">Could not load your account. <button type="button" className="bm-btn bm-btn-sm" onClick={() => q.refetch()}>Retry</button></div></Shell>;
  if (!q.data?.profile) return <ChatProfile setup />;
  return <>{children}</>;
}

export function ChatProfile({ setup = false }: { setup?: boolean }) {
  const qc = useQueryClient();
  const [, nav] = useLocation();
  const q = useGetMyProfile();
  const me = useGetSocialMe({ query: { queryKey: getGetSocialMeQueryKey(), enabled: !!q.data?.profile, refetchInterval: 60_000 } });
  const equipBadge = useEquipMyBadge();
  const save = useSaveMyProfile();
  const profile = q.data?.profile ?? null;
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [bio, setBio] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const replaceTarget = useRef<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);
  const [badgeMessage, setBadgeMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    const replacing = replaceTarget.current;
    setUpErr(null);
    if (uploading || save.isPending) return;
    if (!replacing && photoUrls.length >= 4) { setUpErr('Keep up to 4 photos. Remove or replace one first.'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setUpErr('Choose a JPEG, PNG or WebP image.'); return; }
    if (file.size > 5 * 1024 * 1024) { setUpErr('Photo must be 5 MiB or smaller.'); return; }
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/me/photo`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      if (!res.ok) { let m = 'Photo upload failed.'; try { m = (await res.json()).error ?? m; } catch { /* ignore */ } throw new Error(m); }
      const j = (await res.json()) as { photoUrl: string };
      setPhotoUrls(previous => replacing ? previous.map(url => url === replacing ? j.photoUrl : url) : [...previous, j.photoUrl]);
      setPhotoUrl(current => !current || current === replacing ? j.photoUrl : current);
      setPreview(null); setSaved(false);
    } catch (e) { setUpErr(e instanceof Error ? e.message : 'Photo upload failed.'); setPreview(null); }
    finally { setUploading(false); replaceTarget.current = null; if (fileRef.current) fileRef.current.value = ''; }
  };
  const [saved, setSaved] = useState(false);
  const [tried, setTried] = useState(false);
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (profile && loadedFor.current !== profile.updatedAt) {
      loadedFor.current = profile.updatedAt;
      setPhotoUrl(profile.photoUrl ?? null);
      setPhotoUrls(profile.photoUrls?.length ? [...profile.photoUrls] : profile.photoUrl ? [profile.photoUrl] : []);
      setDisplayName(profile.displayName ?? profile.username);
      setBio(profile.bio ?? '');
    }
  }, [profile?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownDisplay = profile || nameTouched ? displayName : username;
  const nameOk = !!profile || /^[A-Za-z0-9_]{3,24}$/.test(username);
  const dn = shownDisplay.trim();
  const dnOk = dn.length >= 1 && dn.length <= 40;
  const bioOk = bio.length <= 280;
  const setEquippedBadge = (badgeId: string | null) => {
    setBadgeMessage(null);
    equipBadge.mutate({ data: { badgeId } }, {
      onSuccess: () => {
        invalidateSocial(qc);
        void me.refetch();
        setBadgeMessage(badgeId ? 'Badge equipped.' : 'Badge unequipped.');
      },
      onError: (error) => setBadgeMessage(errMessage(error)),
    });
  };
  const submit = () => {
    setTried(true); setSaved(false);
    if (!nameOk || !dnOk || !bioOk || save.isPending || uploading) return;
    const data = { username: profile?.username ?? username, displayName: dn, bio: bio.trim(), photoUrl, photoUrls };
    save.mutate({ data }, {
      onSuccess: (p) => {
        qc.setQueryData(getGetMyProfileQueryKey(), { profile: p });
        qc.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
        invalidateSocial(qc);
        setSaved(true);
        if (!profile) nav('/home');
      },
    });
  };
  const body = (
    <>
      {!setup && <div className="ch-top"><Link href="/user-portal" className="bm-btn bm-btn-sm">Back to profile</Link><Link href="/home" className="bm-btn bm-btn-sm">Directory</Link><Link href="/community/profile" className="bm-btn bm-btn-sm">Platform and bio</Link><Link href="/community" className="bm-btn bm-btn-sm">Community</Link></div>}
      <h1>{profile ? 'Edit profile' : 'Set up your profile'}</h1>
      {profile && <p className="ch-note">Username @{profile.username} is permanent.</p>}
      {q.isLoading && <p role="status">Loading...</p>}
      {q.isError && <div className="ch-err" role="alert">Could not load your account. <button type="button" className="bm-btn bm-btn-sm" onClick={() => q.refetch()}>Retry</button></div>}
      {q.data && (
        <form noValidate onSubmit={(e) => { e.preventDefault(); submit(); }} className="ch-form">
          {!profile && (
            <label>Username (permanent, 3-24 letters, digits, underscores)
              <input type="text" value={username} maxLength={24} autoComplete="username" aria-invalid={tried && !nameOk} onChange={(e) => setUsername(e.target.value)} data-testid="input-username" />
              {tried && !nameOk && <span className="ch-fe" role="alert">Use 3-24 letters, digits or underscores.</span>}
            </label>
          )}
          <label>Display name
            <input type="text" value={shownDisplay} maxLength={40} aria-invalid={tried && !dnOk} onChange={(e) => { setNameTouched(true); setDisplayName(e.target.value); }} data-testid="input-display-name" />
            <span className="ch-field-count">{shownDisplay.length}/40</span>
            {tried && !dnOk && <span className="ch-fe" role="alert">Enter a display name.</span>}
          </label>
          <label>Bio
            <textarea value={bio} maxLength={280} rows={3} onChange={(e) => setBio(e.target.value)} data-testid="input-bio" />
            <span className="ch-field-count">{bio.length}/280</span>
          </label>
          <div>
            <div className="ch-photo-heading"><b>Profile photos</b><span>{photoUrls.length}/4</span></div>
            <div className="ch-photos" aria-label="Saved profile photos">
              {photoUrls.map((url, i) => {
                const status = profile?.photoReviews?.find(p => p.photoUrl === url)?.status ?? 'pending';
                const replacingPreview = !!preview && replaceTarget.current === url;
                const statusLabel = status === 'approved' ? '✓ Approved' : status === 'pending' ? 'Pending review' : status === 'rejected' ? 'Rejected' : 'Flagged';
                const statusClass = status === 'approved' ? 'is-approved' : status === 'pending' ? 'is-pending' : 'is-rejected';
                return (
                  <div className="ch-photo-card" key={url}>
                    {photoUrl === url && <span className="ch-photo-main">Main</span>}
                    <UserPhoto username={profile?.username ?? username} displayName={dn} photoUrl={replacingPreview ? preview : url} size={72} />
                    <span className={`ch-photo-status ${replacingPreview ? 'is-uploading' : statusClass}`} role="status">{replacingPreview ? 'Uploading…' : statusLabel}</span>
                    <div className="ch-photo-actions">
                      <button type="button" className="bm-btn bm-btn-sm" aria-pressed={photoUrl === url} aria-label={`Use photo ${i + 1} as main photo`} disabled={uploading || save.isPending}
                        onClick={() => { setPhotoUrl(url); setSaved(false); }} data-testid={`button-main-photo-${i}`}>{photoUrl === url ? 'Main' : 'Make main'}</button>
                      <button type="button" className="bm-btn bm-btn-sm" aria-label={`Replace photo ${i + 1}`} disabled={uploading || save.isPending}
                        onClick={() => { replaceTarget.current = url; fileRef.current?.click(); }} data-testid={`button-replace-photo-${i}`}>Replace</button>
                      <button type="button" className="bm-btn bm-btn-sm" aria-label={`Remove photo ${i + 1}`} disabled={uploading || save.isPending}
                        onClick={() => { const remaining = photoUrls.filter(item => item !== url); setPhotoUrls(remaining); if (photoUrl === url) setPhotoUrl(remaining[0] ?? null); setUpErr(null); setSaved(false); }} data-testid={`button-remove-photo-${i}`}>Remove</button>
                    </div>
                  </div>
                );
              })}
              {preview && !replaceTarget.current && <div className="ch-photo-card ch-photo-uploading"><UserPhoto displayName={dn} photoUrl={preview} size={72} /><span className="ch-photo-status is-uploading" role="status">Uploading…</span></div>}
              {Array.from({ length: Math.max(0, 4 - photoUrls.length - (preview && !replaceTarget.current ? 1 : 0)) }, (_, slot) => (
                <button type="button" className="ch-photo-card ch-photo-empty" key={`empty-photo-${slot}`} disabled={photoUrls.length >= 4 || uploading || save.isPending}
                  aria-label="Add photo" onClick={() => { replaceTarget.current = null; fileRef.current?.click(); }}
                  data-testid={photoUrls.length === 0 && slot === 0 ? 'button-add-photo' : `button-add-photo-${slot}`}>
                  <span className="ch-add-plus" aria-hidden="true">+</span><span>Add photo</span>
                </button>
              ))}
            </div>
            <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp" aria-label="Upload profile photo" disabled={uploading || save.isPending} onChange={(e) => pickPhoto(e.target.files?.[0])} data-testid="input-photo" />
            <p className="ch-note">Add up to 4 photos and choose one main photo. Only approved photos are visible to others. No sexual or explicit photos; keep your profile professional. JPEG, PNG or WebP, up to 5 MiB each. Save changes to apply.{photoUrls.length >= 4 ? ' At the limit: replace or remove a photo to change your collection.' : ''}</p>
            {profile && <section className="ch-my-badges" aria-labelledby="my-badges-title" data-testid="section-my-badges">
              <div className="ch-my-badges-heading">
                <h2 id="my-badges-title">My Badges</h2>
                <span>{me.data?.badges.length ?? 0}</span>
              </div>
              {me.isLoading ? <p role="status">Loading badges…</p> : me.isError
                ? <p className="ch-fe" role="alert">Could not load your badges. <button type="button" onClick={() => me.refetch()}>Retry</button></p>
                : me.data?.badges.length
                  ? <div className="ch-my-badges-grid">
                    {me.data.badges.map((badge) => (
                      <article className={`ch-my-badge${badge.equipped ? ' is-equipped' : ''}`} key={badge.id} data-testid={`my-badge-${badge.id}`}>
                        <BadgeArt id={badge.id} name={badge.name} imageUrl={badge.badgeImage} size={88} />
                        <b className="ch-my-badge-name">{badge.name}</b>
                        <span className="ch-my-badge-time">{badge.permanent ? 'Permanent' : `${badge.daysLeft ?? 1} ${badge.daysLeft === 1 ? 'day' : 'days'} left`}</span>
                        <button type="button" className={`bm-btn bm-btn-sm${badge.equipped ? '' : ' bm-btn-primary'}`}
                          aria-pressed={badge.equipped} disabled={equipBadge.isPending}
                          onClick={() => setEquippedBadge(badge.equipped ? null : badge.id)}
                          data-testid={`button-equip-${badge.id}`}>
                          {equipBadge.isPending ? 'Saving…' : badge.equipped ? 'Unequip' : 'Equip'}
                        </button>
                      </article>
                    ))}
                  </div>
                  : <p className="ch-my-badges-empty">No badges yet. Buy credits to earn one.</p>}
              {badgeMessage && <p className={equipBadge.isError ? 'ch-fe' : 'ch-my-badge-status'} role={equipBadge.isError ? 'alert' : 'status'}>{badgeMessage}</p>}
            </section>}
            {upErr && <div className="ch-err" role="alert">{upErr}</div>}
          </div>
          {save.isError && <div className="ch-err" role="alert">{errMessage(save.error)}</div>}
          {saved && <p role="status">Saved.</p>}
          <p><button type="submit" className="bm-btn bm-btn-primary" disabled={save.isPending || uploading} data-testid="button-save-identity">
            {save.isPending ? 'Saving...' : profile ? 'Save changes' : 'Create profile'}</button></p>
        </form>
      )}
      <p className="ch-note">{DISCLAIMER}</p>
    </>
  );
  return <Shell className="ch-profile-screen">{body}</Shell>;
}

export { TextChatRoom } from './UniversityRoom';

export function ModerationQueue() {
  const qc = useQueryClient();
  const access = useGetChatAccess();
  const q = useGetChatReports({ query: { queryKey: getGetChatReportsQueryKey(), enabled: !!access.data?.moderator } });
  const review = useReviewChatReport();
  if (access.isLoading) return <p role="status">Loading...</p>;
  if (!access.data?.moderator) return <div className="sc-empty"><h2>Restricted</h2><p>Moderators only.</p></div>;
  return (
    <section className="ch">
      <h1 className="bm-h1 sc-h1">Moderation</h1>
      <PhotoReviewQueue />
      <BotModerationPanel />
      {q.isLoading && <p role="status">Loading reports...</p>}
      {q.isError && <div className="ch-err" role="alert">Could not load. <button type="button" className="bm-btn bm-btn-sm" onClick={() => q.refetch()}>Retry</button></div>}
      {review.isError && <div className="ch-err" role="alert">{errMessage(review.error)}</div>}
      {q.data?.length === 0 && <p>Queue is empty.</p>}
      <ul className="ch-list">{q.data?.map((x) => (
        <li key={x.id}><div><b>{x.username}</b> in {x.roomId} ({x.reason}, {x.status})<p>{x.text}</p>{x.details && <p className="ch-note">{x.details}</p>}</div>
          {x.status === 'pending' && <div>{Object.values(ChatReportReviewInputAction).map((a) => (
            <button key={a} type="button" className="bm-btn bm-btn-sm" disabled={review.isPending} onClick={() => review.mutate({ reportId: x.id, data: { action: a } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetChatReportsQueryKey() }) })}>{a}</button>))}</div>}</li>))}</ul>
    </section>
  );
}
