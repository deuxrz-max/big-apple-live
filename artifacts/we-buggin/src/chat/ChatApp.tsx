import '@/beam/beam.css';
import '@/social/social.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Coins, Flame, Users, X } from 'lucide-react';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetChatAccessQueryKey, getGetMyProfileQueryKey, getGetSocialMeQueryKey,
  useConfirmChatAdult, useGetChatAccess, useGetChatDirectory,
  useGetMyProfile, useGetSocialMe, useSaveMyProfile,
  getGetChatDirectoryQueryKey,
  getGetSocialInboxQueryKey, useGetSocialInbox,
} from '@workspace/api-client-react';
import { UserPhoto } from '@/components/user-photo';
import { AppLogo, Wordmark } from '@/components/brand';
import { errMessage } from '@/lib/errors';
import { PhotoReviewQueue } from './PhotoReviewQueue';
import { BotModerationPanel } from './BotModerationPanel';
import { selectFeaturedRoom } from './directory-utils';
import { RoomChannels } from './RoomChannels';
import { CreateRoomButton } from './CreateRoomButton';
import { ActionMenu, ScreenHeader } from '@/components/app-chrome';
import { AccessCheckError } from './AccessCheckError';
import { ProfilePreferences } from '@/social/PeoplePages';
import './chat.css';

const DISCLAIMER = 'Big Apple Live is independent and is not affiliated with, endorsed by, or sponsored by any platform named here.';

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
      {q.data && q.data.length > 0 && rows.length === 0 && <p>No room matches your search.</p>}
      <RoomChannels rooms={rows} loading={q.isLoading} baseHref={preview ? '/' : '/home'} showMap={!preview}
        renderRoom={room => <DirectoryRoomCard room={room} topic={room.label} isFeatured={false} preview={preview} />}
        goLive={<Link href="/sign-in" className="st-home-go-live-button"><span className="st-home-go-live-copy"><strong>Create Room</strong><small>Start an audio room</small></span></Link>}
      />
    </>
  );
}

function CreditsChip() {
  const me = useGetSocialMe();
  if (!me.data) return null;
  return <span className="st-credits" data-testid="text-credits" aria-label="Coin balance">
    <Coins size={13} aria-hidden="true" style={{ color: '#f5cb8d' }} />
    {me.data.wallet.unlimited ? 'Unlimited test coins' : `${me.data.wallet.balance.toLocaleString()} coins`}
  </span>;
}

function TopBar({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="st-topbar">
      <Wordmark href={signedIn ? '/home' : '/'} className="st-brand" transparentLogo />
      {signedIn ? <><CreateRoomButton className="st-topbar-live"><Users size={15} /> Create room</CreateRoomButton><CreditsChip /></> : <Link href="/sign-in" className="bm-btn bm-btn-sm bm-btn-primary">Sign in</Link>}
    </div>
  );
}

export function PublicChatLanding() {
  return (
    <Shell className="dw-landing">
      <TopBar signedIn={false} />
      <section className="dw-landing-hero" aria-labelledby="dw-landing-title" data-testid="section-landing-hero">
        <span className="dw-landing-kicker"><i aria-hidden="true" /> Social audio rooms</span>
        <h1 id="dw-landing-title">Find your people.</h1>
        <p>Drop into an audio room. Meet people and join the conversation.</p>
        <div className="dw-landing-cta">
          <Link href="/sign-up" className="bm-btn bm-btn-primary" data-testid="link-landing-sign-up">Create account</Link>
          <Link href="/sign-in" className="bm-btn" data-testid="link-landing-sign-in">Sign in</Link>
          <Link href="/battle" className="bm-btn bm-btn-primary dw-battle-cta" data-testid="link-public-battle">Battle</Link>
        </div>
        <ul className="dw-landing-points" aria-label="What you can do">
          <li><Users size={16} aria-hidden="true" /> Join audio rooms</li>
          <li><Users size={16} aria-hidden="true" /> Join conversations</li>
        </ul>
        <details className="dw-landing-about">
          <summary>About Big Apple Live</summary>
          <p>Big Apple Live is a social platform for audio rooms and messaging.</p>
        </details>
      </section>
      <section className="dw-landing-rooms" aria-labelledby="dw-landing-rooms-title">
        <div className="dw-section-head"><span className="dw-overline">Happening now</span><h2 id="dw-landing-rooms-title">Rooms</h2></div>
        <List preview />
      </section>
      <footer className="dw-landing-foot"><p className="ch-note">{DISCLAIMER}</p></footer>
    </Shell>
  );
}

export function AdultGate({ children, keepMountedOnTransientError = false }: {
  children: ReactNode;
  keepMountedOnTransientError?: boolean;
}) {
  const { signOut } = useClerk();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const q = useGetChatAccess();
  const confirm = useConfirmChatAdult();
  const [ok, setOk] = useState(false);
  const lastSuccessfulAccess = useRef(q.data);
  if (q.data) lastSuccessfulAccess.current = q.data;
  const access = q.data ?? (keepMountedOnTransientError ? lastSuccessfulAccess.current : undefined);
  if (q.isLoading && !access) return <Shell><p role="status">Checking access...</p></Shell>;
  if ((q.isError && !keepMountedOnTransientError) || !access) return (
    <Shell>
      <AccessCheckError
        retry={() => { void q.refetch(); }}
        goBack={() => {
          if (window.history.length > 1) window.history.back();
          else navigate('/user-portal');
        }}
        signOut={() => signOut({ redirectUrl: import.meta.env.BASE_URL || '/' })}
      />
    </Shell>
  );
  if (access.suspended) return <Shell><h1>Chat access restricted</h1><p>Your access requires review by a Big Apple Live moderator. A new age confirmation cannot remove this restriction.</p><Link href="/" className="bm-btn">Home</Link></Shell>;
  if (access.adultConfirmed) return <>{children}</>;
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

export function HomeSections() {
  return <nav className="dw-home-tabs" aria-label="Home sections" data-testid="nav-home-sections">
    <a href="#live-channels" className="is-on" aria-current="location">Rooms</a>
  </nav>;
}

export function ChatDirectory() {
  const { signOut } = useClerk();
  const directory = useGetChatDirectory({ query: { queryKey: getGetChatDirectoryQueryKey(), refetchInterval: 5_000 } });
  const me = useGetMyProfile({ query: { queryKey: getGetMyProfileQueryKey(), refetchInterval: 60_000 } });
  const socialMe = useGetSocialMe({ query: { queryKey: getGetSocialMeQueryKey(), refetchInterval: 60_000 } });
  const topics = ['Music', 'Movies', 'Comedy', 'Sports', 'Pro Wrestling', 'Web Series', 'History', 'News'];
  type DirectoryRoom = { roomId: string; label: string; headcount: number; headcountSince: number };
  const rooms = (directory.data ?? []) as DirectoryRoom[];
  const featuredRoom = selectFeaturedRoom(rooms);
  const displayedRooms = featuredRoom
    ? [featuredRoom, ...rooms.filter((room) => room.roomId !== featuredRoom.roomId)]
    : rooms;
  const topicFor = (room: DirectoryRoom) => {
    const source = `${room.label} ${room.roomId}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    return topics.find((topic) => source.includes(topic.toLowerCase())) ?? room.label;
  };
  return (
    <Shell className="st-directory st-home">
      <div className="st-home-background" aria-hidden="true" />
      <header className="st-dir-header">
        <div className="st-dir-topline">
          <div className="st-dir-lockup">
            <Link href="/home" className="st-home-app-logo" aria-label="Big Apple Live home" data-testid="link-home-logo"><AppLogo size={36} /></Link>
            <span className="dw-home-title"><strong>Big Apple Live</strong><small>Audio rooms</small></span>
          </div>
          <div className="st-dir-account">
            <span className={`st-dir-wallet${socialMe.data?.wallet.unlimited ? ' is-unlimited' : ''}`} aria-label="Coin balance" data-testid="link-home-wallet">
              {socialMe.data?.wallet.unlimited
                ? <><i aria-hidden="true" />Unlimited</>
                : socialMe.data
                  ? <><Coins size={13} aria-hidden="true" style={{ color: '#f5cb8d' }} />{socialMe.data.wallet.balance.toLocaleString()} coins</>
                  : socialMe.isLoading ? '…' : 'Coins'}
            </span>
            <details className="st-dir-menu st-home-profile-menu">
              <summary className="st-dir-avatar st-home-avatar" aria-label={`Open profile menu${me.data?.profile?.username ? ` for ${me.data.profile.username}` : ''}`} data-testid="button-home-profile-menu">
                <UserPhoto username={me.data?.profile?.username} displayName={me.data?.profile?.displayName}
                  photoUrl={me.data?.profile?.photoUrl} size={36} />
                <i aria-hidden="true" />
              </summary>
              <div className="st-home-profile-dropdown">
                <Link href="/user-portal" data-testid="link-home-profile">Profile</Link>
                <button type="button" data-testid="button-home-sign-out" onClick={() => signOut({ redirectUrl: import.meta.env.BASE_URL || '/' })}>Sign out</button>
              </div>
            </details>
          </div>
        </div>
      </header>

      <HomeSections />
      <Link href="/battle" className="bm-btn bm-btn-primary dw-home-battle-cta" data-testid="link-home-battle">Open Battle</Link>
      <section className="st-dir-explore st-home-rooms" id="live-channels" aria-label="Rooms">
        {directory.isError && <div className="st-dir-state st-dir-error" role="alert"><div className="st-dir-state-mark">!</div><h3>Rooms aren’t loading</h3><p>We couldn’t reach the directory. Give it another try.</p><button type="button" onClick={() => directory.refetch()}>Retry directory</button></div>}
        {directory.data && rooms.length === 0 && <div className="st-dir-state"><div className="st-dir-state-mark">—</div><h3>Quiet for a moment</h3><p>There are no rooms in the directory right now. Check back soon.</p></div>}
        <RoomChannels
          rooms={displayedRooms}
          loading={directory.isLoading}
          showOtherRoomSigns
          renderRoom={(room) => <DirectoryRoomCard room={room} topic={topicFor(room)} isFeatured={room.roomId === featuredRoom?.roomId} hideDetails />}
          goLive={<CreateRoomButton className="st-home-go-live-button">
            <span className="st-home-go-live-copy"><strong>Create Room</strong><small>Start a four-player audio room</small></span>
          </CreateRoomButton>}
        />
      </section>
      <footer className="st-dir-footer"><span>BIG APPLE LIVE · FIND YOUR PEOPLE</span></footer>
    </Shell>
  );
}

export function DirectoryRoomCard({ room, topic, isFeatured, preview = false, hideDetails = false }: {
  room: { roomId: string; label: string; headcount: number };
  topic: string;
  isFeatured: boolean;
  preview?: boolean;
  hideDetails?: boolean;
}) {
  const [topicPhotoFailed, setTopicPhotoFailed] = useState(false);
  const hasTopicPhoto = !topicPhotoFailed;
  const isWrestling = topic === 'Pro Wrestling';
  return (
    <Link href={preview ? '/sign-in' : `/rooms/${encodeURIComponent(room.roomId)}`} className={`st-dir-card${isFeatured ? ' is-featured' : ''}`} aria-label={`Enter ${room.label}, ${room.headcount} ${room.headcount === 1 ? 'person' : 'people'} here${isFeatured ? ', featured room' : ''}`} data-testid={`card-home-room-${room.roomId}`}>
      <div className={`st-dir-art st-dir-art-${topicClass(topic)}`}>
        {isWrestling
            ? <WrestlingArenaArt />
            : hasTopicPhoto
            ? <img className="st-dir-topic-photo" src={topicPhotoUrl(topic)} alt="" loading="lazy" onError={() => setTopicPhotoFailed(true)} />
            : <div className="st-dir-art-fallback" aria-hidden="true"><span className="st-dir-art-index">{topicInitial(topic)}</span><span className="st-dir-art-lines" /></div>}
        {(!hideDetails || room.headcount > 0) && <span className={`st-home-live-label${room.headcount > 0 ? ' is-live' : ''}`} title={hideDetails ? undefined : room.label}>
          {room.headcount > 0 && <><i aria-hidden="true" /><b>LIVE</b></>}{!hideDetails && <span>{room.label}</span>}
        </span>}
        {!hideDetails && isFeatured && <span className="st-home-featured-badge">Featured</span>}
        <span className="st-dir-art-shade" />
        {!hideDetails && <div className="st-home-card-copy"><span className="st-home-card-category">{topic}</span></div>}
        <span className="st-dir-count" aria-label={`${room.headcount} people in ${room.label}`}>
          <Flame size={12} aria-hidden="true" /><span>{room.headcount}</span>
        </span>
      </div>
    </Link>
  );
}

function WrestlingArenaArt() {
  return (
    <svg className="st-dir-topic-photo st-wrestling-arena-art" viewBox="0 0 480 600" role="img" aria-label="Wrestling ring under arena lights" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="wrestling-arena-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#080705" />
          <stop offset=".48" stopColor="#33270e" />
          <stop offset="1" stopColor="#000000" />
        </linearGradient>
        <linearGradient id="wrestling-ring-mat" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#dfc782" />
          <stop offset="1" stopColor="#7b632e" />
        </linearGradient>
        <radialGradient id="wrestling-spotlight">
          <stop stopColor="#fff4d3" stopOpacity=".95" />
          <stop offset="1" stopColor="#d4b15f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wrestling-ropes" x1="0" x2="1">
          <stop stopColor="#fff0c2" />
          <stop offset=".52" stopColor="#d4b15f" />
          <stop offset="1" stopColor="#fff4d3" />
        </linearGradient>
      </defs>
      <rect width="480" height="600" fill="url(#wrestling-arena-bg)" />
      <ellipse cx="240" cy="142" rx="205" ry="160" fill="url(#wrestling-spotlight)" opacity=".62" />
      <path d="M58 0 211 276H159L0 75V0Zm365 0L270 276h52L480 73V0Z" fill="#ffe6a0" opacity=".13" />
      <g fill="#fff5db">
        <circle cx="80" cy="63" r="7" /><circle cx="128" cy="50" r="5" />
        <circle cx="351" cy="49" r="5" /><circle cx="403" cy="62" r="7" />
      </g>
      <path d="M0 330q48-44 96 0t96 0 96 0 96 0 96 0v150H0Z" fill="#100d07" />
      <g fill="#4c3d20" opacity=".9">
        <circle cx="32" cy="366" r="18" /><circle cx="83" cy="389" r="15" /><circle cx="131" cy="365" r="18" />
        <circle cx="181" cy="393" r="17" /><circle cx="230" cy="366" r="18" /><circle cx="282" cy="392" r="16" />
        <circle cx="333" cy="365" r="18" /><circle cx="383" cy="393" r="16" /><circle cx="447" cy="365" r="20" />
      </g>
      <path d="M58 470 138 390h204l80 80-85 99H143Z" fill="#19150c" stroke="#e6c878" strokeOpacity=".55" strokeWidth="5" />
      <path d="m138 390 102 43 102-43H138Z" fill="url(#wrestling-ring-mat)" />
      <path d="m143 489 97-56 97 56H143Z" fill="#a88b47" />
      <path d="M143 489v93m194-93v93M138 390v99m204-99v99" stroke="#c8ab61" strokeWidth="5" />
      <path d="M69 426h342M62 449h356M56 474h368" fill="none" stroke="#392b10" strokeWidth="12" opacity=".85" />
      <path d="M69 423h342M62 446h356M56 471h368" fill="none" stroke="url(#wrestling-ropes)" strokeWidth="5" />
      <path d="M80 420v66m320-66v66" stroke="#e6c878" strokeWidth="7" />
      <path d="M215 390v48m37-48v48" stroke="#685126" strokeWidth="3" opacity=".7" />
    </svg>
  );
}

function topicClass(topic: string) {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function topicInitial(topic: string) {
  const initials: Record<string, string> = { 'Pro Wrestling': 'PW', 'Web Series': 'WS', Comedy: '🎭' };
  return initials[topic] ?? topic.slice(0, 1).toUpperCase();
}

function topicPhotoUrl(topic: string) {
  const photoIds: Record<string, string> = {
    Music: 'photo-1492684223066-81342ee5ff30',
    Movies: 'photo-1489599849927-2ee91cede3ba',
    Comedy: 'photo-1527224857830-43a7acc85260',
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

/**
 * Live routes must remain mounted after their profile has passed the gate.
 * A transient background refresh error should not destroy the current page.
 */
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
  const submit = () => {
    setTried(true); setSaved(false);
    if (!nameOk || !dnOk || !bioOk || save.isPending || uploading) return;
    // Existing accounts edit bio only in the shared preferences form below.
    // Identity/photo saves must not overwrite a separately saved bio.
    const data = { username: profile?.username ?? username, displayName: dn, ...(!profile ? { bio: bio.trim() } : {}), photoUrl, photoUrls };
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
      <ScreenHeader backHref={setup ? undefined : '/user-portal'} backLabel="Back to profile" testId="header-edit-profile"
        title={profile ? 'Edit profile' : 'Set up your profile'}
        actions={!setup && <ActionMenu label="More profile settings" testId="menu-edit-profile">
          <a href="#profile-preferences" role="menuitem" data-testid="link-edit-platform-bio">Profile preferences</a>
          <Link href="/community" role="menuitem" data-testid="link-edit-community">Community</Link>
          <Link href="/home" role="menuitem" data-testid="link-edit-directory">Home</Link>
        </ActionMenu>} />
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
          {!profile && <label>Bio
            <textarea value={bio} maxLength={280} rows={3} onChange={(e) => setBio(e.target.value)} data-testid="input-bio" />
            <span className="ch-field-count">{bio.length}/280</span>
          </label>}
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
            {upErr && <div className="ch-err" role="alert">{upErr}</div>}
          </div>
          {save.isError && <div className="ch-err" role="alert">{errMessage(save.error)}</div>}
          {saved && <p role="status">Saved.</p>}
          <p><button type="submit" className="bm-btn bm-btn-primary" disabled={save.isPending || uploading} data-testid="button-save-identity">
            {save.isPending ? 'Saving...' : profile ? 'Save changes' : 'Create profile'}</button></p>
        </form>
      )}
      {profile && <ProfilePreferences />}
      <p className="ch-note">{DISCLAIMER}</p>
    </>
  );
  return <Shell className="ch-profile-screen">{body}</Shell>;
}

export { TextChatRoom } from './UniversityRoom';

export function ModerationQueue() {
  const access = useGetChatAccess();
  if (access.isLoading) return <p role="status">Loading...</p>;
  if (!access.data?.moderator) return <div className="sc-empty"><h2>Restricted</h2><p>Moderators only.</p></div>;
  return (
    <section className="ch">
      <h1 className="bm-h1 sc-h1">Moderation</h1>
      {access.data.owner && <p><Link className="bm-btn bm-btn-primary" href="/community/reports">Open safety reports</Link></p>}
      <PhotoReviewQueue />
      <BotModerationPanel />
      <p className="ch-note">Safety reports are reviewed separately and visible only to the account owner.</p>
    </section>
  );
}

export function ProfilePhotoReviewPage() {
  const access = useGetChatAccess();
  if (access.isLoading) return <Shell><p role="status">Loading photo review…</p></Shell>;
  if (access.isError) return <Shell><p role="alert">{errMessage(access.error)} <button className="bm-btn bm-btn-sm" onClick={() => access.refetch()}>Retry</button></p></Shell>;
  if (!access.data?.adultConfirmed)
    return <Shell><div className="sc-empty" role="status"><h1>Access required</h1><p>Confirm adult access before reviewing profile photos.</p></div></Shell>;
  if (!access.data?.moderator && !access.data?.owner)
    return <Shell><div className="sc-empty" role="status"><h1>Restricted</h1><p>Photo review is limited to the Big Apple Live owner and authorized moderators.</p></div></Shell>;
  return <Shell>
    <ScreenHeader backHref="/user-portal" backLabel="Back to Me" title="Photo review" testId="header-photo-review" />
    <PhotoReviewQueue />
  </Shell>;
}
