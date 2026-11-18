import '@/beam/beam.css';
import '@/social/social.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Flame, Swords, Trophy, Users, X } from 'lucide-react';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetChatAccessQueryKey, getGetMyProfileQueryKey, getGetSocialMeQueryKey,
  useConfirmChatAdult, useGetChatAccess, useGetChatDirectory,
  useGetMyProfile, useGetSocialMe, useSaveMyProfile, useSaveSocialProfile,
  getGetChatDirectoryQueryKey,
  getGetSocialInboxQueryKey, useGetSocialInbox,
} from '@workspace/api-client-react';
import { UserPhoto } from '@/components/user-photo';
import { AppLogo, Wordmark } from '@/components/brand';
import { errMessage } from '@/lib/errors';
import { PhotoReviewQueue } from './PhotoReviewQueue';
import { BotModerationPanel } from './BotModerationPanel';
import { selectFeaturedRoom } from './directory-utils';
import { RandomCityBattleButton, RoomChannels } from './RoomChannels';
import { CreateRoomButton } from './CreateRoomButton';
import { battleHrefForCity, dailyAethelgardCity, randomAethelgardCity, type AethelgardCity } from '@/battle/aethelgard-cities';
import { CITY_BOSSES } from '@/battle/boss-config';
import { ActionMenu, ScreenHeader } from '@/components/app-chrome';
import { AccessCheckError } from './AccessCheckError';
import './chat.css';

const STARTER_JOBS = ['Apprentice', 'Squire', 'Initiate', 'Trapper', 'Novice', 'Acolyte', 'Scoundrel', 'Tinker'] as const;
type StarterJob = typeof STARTER_JOBS[number];
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
      <RoomChannels rooms={rows} loading={q.isLoading} baseHref={preview ? '/' : '/home'}
        battle={preview
          ? <Link href="/sign-in" className="bm-btn bm-btn-primary dw-battle-cta" data-testid="link-public-battle"><Swords size={17} aria-hidden="true" /> Battle</Link>
          : <CreateRoomButton className="bm-btn bm-btn-primary dw-battle-cta"><Swords size={17} aria-hidden="true" /> Battle</CreateRoomButton>}
        random={<RandomCityBattleButton testId={preview ? 'button-public-random-city' : 'button-home-random-city'} />}
        renderRoom={room => <DirectoryRoomCard room={room} topic={displayRoomName(room.label)} isFeatured={false} preview={preview} />}
        goLive={null}
      />
    </>
  );
}

function TopBar({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="st-topbar">
      <Wordmark href={signedIn ? '/home' : '/'} className="st-brand" transparentLogo />
      {signedIn ? <CreateRoomButton className="st-topbar-live"><Users size={15} /> Create room</CreateRoomButton> : <div className="st-topbar-actions">
        <Link href="/leaderboard" className="bm-btn bm-btn-sm st-home-leaderboard" aria-label="Leaderboard" title="Leaderboard" data-testid="link-header-leaderboard"><Trophy size={18} aria-hidden="true" /></Link>
        <Link href="/sign-in" className="bm-btn bm-btn-sm bm-btn-primary">Sign in</Link>
      </div>}
    </div>
  );
}

export function PublicChatLanding() {
  return (
    <Shell className="dw-landing">
      <TopBar signedIn={false} />
      <section className="dw-landing-rooms" aria-labelledby="dw-landing-rooms-title">
        <div className="dw-section-head"><span className="dw-overline">Explore</span><h2 id="dw-landing-rooms-title">Rooms</h2></div>
        <List preview />
      </section>
      <section className="dw-landing-hero" aria-labelledby="dw-landing-title" data-testid="section-landing-hero">
        <span className="dw-landing-kicker"><i aria-hidden="true" /> Social audio rooms</span>
        <h1 id="dw-landing-title">Find your people.</h1>
        <p>Drop into an audio room. Meet people and join the conversation.</p>
        <div className="dw-landing-cta">
          <Link href="/sign-up" className="bm-btn bm-btn-primary" data-testid="link-landing-sign-up">Create account</Link>
          <Link href="/sign-in" className="bm-btn" data-testid="link-landing-sign-in">Sign in</Link>
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

/**
 * Home map Battle button: games can start from the homepage or inside a room,
 * so tapping it offers the choice — create a room, or play the game (a battle
 * in a random city, the same destination as the Random button).
 */
export function HomeBattleButton() {
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [playCity, setPlayCity] = useState<AethelgardCity | null>(null);
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!choiceOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChoiceOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    dialog.current?.querySelector<HTMLButtonElement | HTMLAnchorElement>('button, a')?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [choiceOpen]);

  const openChoice = () => {
    setPlayCity(randomAethelgardCity());
    setChoiceOpen(true);
  };
  const playBoss = playCity ? CITY_BOSSES[playCity.slug] : undefined;

  return (
    <>
      <button type="button" className="bm-btn bm-btn-primary dw-battle-cta" aria-haspopup="dialog" aria-expanded={choiceOpen}
        onClick={openChoice}>
        <Swords size={17} aria-hidden="true" /> Battle
      </button>
      {choiceOpen && playCity && (
        <div className="st-room-choice-scrim" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setChoiceOpen(false);
        }}>
          <section ref={dialog} className="st-room-choice-card" role="dialog" aria-modal="true"
            aria-labelledby="st-battle-choice-title" data-testid="dialog-battle-choice">
            <button type="button" className="st-room-choice-close" aria-label="Close battle choices"
              onClick={() => setChoiceOpen(false)}><X size={18} /></button>
            <h2 id="st-battle-choice-title">Battle</h2>
            <div className="st-room-choice-room-form">
              <CreateRoomButton className="st-room-choice-option" onOpen={() => setChoiceOpen(false)}>
                <span className="st-room-choice-icon"><Users size={22} aria-hidden="true" /></span>
                <span><strong>Create a room</strong><small>Open a four-player social room with chat and live audio.</small></span>
              </CreateRoomButton>
              <Link href={battleHrefForCity(playCity)} className="st-room-choice-option" data-testid="link-battle-play-game">
                <span className="st-room-choice-icon"><Swords size={22} aria-hidden="true" /></span>
                <span><strong>Play the game</strong><small>{playBoss ? `Battle the ${playBoss.name} in ${playCity.name}.` : `Battle in ${playCity.name}.`}</small></span>
              </Link>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function ChatDirectory() {
  const { signOut } = useClerk();
  const directory = useGetChatDirectory({ query: { queryKey: getGetChatDirectoryQueryKey(), refetchInterval: 5_000 } });
  const me = useGetMyProfile({ query: { queryKey: getGetMyProfileQueryKey(), refetchInterval: 60_000 } });
  const topics = ['Music', 'Movies', 'Comedy', 'Sports', 'Pro Wrestling', 'Web Series', 'History', 'News'];
  type DirectoryRoom = { roomId: string; label: string; headcount: number; headcountSince: number };
  const rooms = (directory.data ?? []) as DirectoryRoom[];
  const featuredRoom = selectFeaturedRoom(rooms);
  const todayCity = dailyAethelgardCity();
  const todayBoss = CITY_BOSSES[todayCity.slug];
  const displayedRooms = featuredRoom
    ? [featuredRoom, ...rooms.filter((room) => room.roomId !== featuredRoom.roomId)]
    : rooms;
  const topicFor = (room: DirectoryRoom) => {
    const source = `${room.label} ${room.roomId}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    return topics.find((topic) => source.includes(topic.toLowerCase())) ?? displayRoomName(room.label);
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
            <Link href="/leaderboard" className="bm-btn bm-btn-sm st-home-leaderboard" aria-label="Leaderboard" title="Leaderboard" data-testid="link-home-leaderboard"><Trophy size={18} aria-hidden="true" /></Link>
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
      <section className="st-dir-explore st-home-rooms" id="live-channels" aria-label="Rooms">
        {directory.isError && <div className="st-dir-state st-dir-error" role="alert"><div className="st-dir-state-mark">!</div><h3>Rooms aren’t loading</h3><p>We couldn’t reach the directory. Give it another try.</p><button type="button" onClick={() => directory.refetch()}>Retry directory</button></div>}
        {directory.data && rooms.length === 0 && (
          <div className="st-dir-state st-dir-happening" data-testid="home-happening-soon">
            <div className="st-dir-state-mark">—</div>
            <h3>Happening soon</h3>
            <p>No rooms are live right now. Battle today’s city or start the first room.</p>
            <div className="st-happening-cards">
              <Link href={battleHrefForCity(todayCity)} className="st-happening-card" data-testid="link-daily-battle">
                <Swords size={17} aria-hidden="true" />
                <span><strong>Daily battle — {todayCity.name}</strong><small>{todayBoss ? `Take on the ${todayBoss.name}` : "Battle today's boss bot"}</small></span>
              </Link>
              <CreateRoomButton className="st-happening-card">
                <Users size={17} aria-hidden="true" />
                <span><strong>Create the first room</strong><small>Open a four-player audio room</small></span>
              </CreateRoomButton>
            </div>
          </div>
        )}
        <RoomChannels
          rooms={displayedRooms}
          loading={directory.isLoading}
          battle={<HomeBattleButton />}
          random={<RandomCityBattleButton testId="button-home-random-city" />}
          renderRoom={(room) => <DirectoryRoomCard room={room} topic={topicFor(room)} isFeatured={room.roomId === featuredRoom?.roomId} hideDetails />}
          goLive={null}
        />
      </section>
      <footer className="st-dir-footer"><span>BIG APPLE LIVE · FIND YOUR PEOPLE</span></footer>
    </Shell>
  );
}

export function BattleLeaderboardPage() {
  return (
    <Shell className="sc">
      <header className="st-topbar">
        <Wordmark href="/home" className="st-brand" transparentLogo />
        <Link href="/home" className="bm-btn bm-btn-sm" data-testid="link-leaderboard-back"><ArrowLeft size={16} aria-hidden="true" /> Home</Link>
      </header>
      <section className="sc-page sc-leaderboard-page" aria-labelledby="leaderboard-title" data-testid="page-leaderboard">
        <h1 className="sc-h1" id="leaderboard-title"><Trophy size={30} aria-hidden="true" /> Battle leaderboard</h1>
        <p className="sc-sub">Ranked by battle wins.</p>
        <div className="sc-empty" role="status" data-testid="leaderboard-empty">
          <h2>No battles yet</h2>
          <p>Battle wins will appear here when recorded.</p>
        </div>
      </section>
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
  const roomName = displayRoomName(room.label);
  if (preview) {
    return (
      <Link href="/sign-in" className="dw-landing-room-card" aria-label={`Sign in to enter ${roomName}`} data-testid={`card-home-room-${room.roomId}`}>
        <strong>{roomName}</strong>
        <span>{room.headcount} here</span>
      </Link>
    );
  }
  return (
    <Link href={`/rooms/${encodeURIComponent(room.roomId)}`} className={`st-dir-card${isFeatured ? ' is-featured' : ''}`} aria-label={`Enter ${roomName}, ${room.headcount} ${room.headcount === 1 ? 'person' : 'people'} here${isFeatured ? ', featured room' : ''}`} data-testid={`card-home-room-${room.roomId}`}>
      <div className={`st-dir-art st-dir-art-${topicClass(topic)}`}>
        {isWrestling
            ? <WrestlingArenaArt />
            : hasTopicPhoto
            ? <img className="st-dir-topic-photo" src={topicPhotoUrl(topic)} alt="" loading="lazy" onError={() => setTopicPhotoFailed(true)} />
            : <div className="st-dir-art-fallback" aria-hidden="true"><span className="st-dir-art-index">{topicInitial(topic)}</span><span className="st-dir-art-lines" /></div>}
        {(!hideDetails || room.headcount > 0) && <span className={`st-home-live-label${room.headcount > 0 ? ' is-live' : ''}`} title={hideDetails ? undefined : roomName}>
          {room.headcount > 0 && <><i aria-hidden="true" /><b>LIVE</b></>}{!hideDetails && <span>{roomName}</span>}
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

function displayRoomName(label: string) {
  return label.trim().replace(/\s+(?:ave(?:nue)?\.?)$/i, '').trim();
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
  const social = useGetSocialMe({ query: { queryKey: getGetSocialMeQueryKey(), enabled: !!q.data?.profile } });
  const save = useSaveMyProfile();
  const saveSocial = useSaveSocialProfile();
  const profile = q.data?.profile ?? null;
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [job, setJob] = useState<StarterJob | ''>('');
  const [race] = useState('Human');
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setUpErr(null);
    if (uploading || save.isPending) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setUpErr('Choose a JPEG, PNG or WebP image.'); return; }
    if (file.size > 5 * 1024 * 1024) { setUpErr('Photo must be 5 MiB or smaller.'); return; }
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/me/photo`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      if (!res.ok) { let m = 'Photo upload failed.'; try { m = (await res.json()).error ?? m; } catch { /* ignore */ } throw new Error(m); }
      const j = (await res.json()) as { photoUrl: string };
      if (profile) {
        const updated = await save.mutateAsync({ data: {
          username: profile.username, displayName: (displayName.trim() || profile.displayName || profile.username),
          photoUrl: j.photoUrl, photoUrls: [j.photoUrl],
        } });
        qc.setQueryData(getGetMyProfileQueryKey(), { profile: updated });
        await invalidateSocial(qc);
        setPhotoUrl(j.photoUrl);
        setSaved(true);
      } else {
        setPhotoUrl(j.photoUrl);
        setSaved(false);
      }
      setPreview(null);
    } catch (e) { setUpErr(e instanceof Error ? e.message : 'Photo upload failed.'); setPreview(null); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const [saved, setSaved] = useState(false);
  const [tried, setTried] = useState(false);
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (profile && loadedFor.current !== profile.updatedAt) {
      loadedFor.current = profile.updatedAt;
      setPhotoUrl(profile.photoUrl ?? null);
      setDisplayName(profile.displayName ?? profile.username);
    }
  }, [profile?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (social.data?.profile) setJob(social.data.profile.job ?? '');
  }, [social.data?.profile?.job]);
  const shownDisplay = profile || nameTouched ? displayName : username;
  const nameOk = !!profile || /^[A-Za-z0-9_]{3,24}$/.test(username);
  const dn = shownDisplay.trim();
  const dnOk = dn.length >= 1 && dn.length <= 40;
  const submit = async () => {
    setTried(true); setSaved(false); setFormErr(null);
    if (!nameOk || !dnOk || save.isPending || saveSocial.isPending || uploading) return;
    try {
      const updated = await save.mutateAsync({
        data: { username: profile?.username ?? username, displayName: dn, photoUrl, photoUrls: photoUrl ? [photoUrl] : [] },
      });
      qc.setQueryData(getGetMyProfileQueryKey(), { profile: updated });
      await saveSocial.mutateAsync({ data: { race: 'Human', job: job || null } });
      await invalidateSocial(qc);
      setSaved(true);
      if (!profile) nav('/home');
    } catch (error) {
      setFormErr(errMessage(error));
    }
  };
  const body = (
    <>
      <ScreenHeader backHref={setup ? undefined : '/user-portal'} backLabel="Back to profile" testId="header-edit-profile" title={profile ? 'Edit profile' : 'Set up your profile'} />
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
          <section className="ch-profile-photo-edit" aria-label="Profile picture">
            <b>Profile picture</b>
            <div className="ch-profile-photo-row">
              <UserPhoto username={profile?.username ?? username} displayName={dn} photoUrl={preview ?? photoUrl} size={96} />
              <div>
                {photoUrl && <p className="ch-photo-status is-pending" role="status">
                  {profile?.photoReviews?.find(item => item.photoUrl === photoUrl)?.status === 'approved'
                    ? 'Approved' : 'Pending review'}
                </p>}
                <button type="button" className="bm-btn bm-btn-sm" disabled={uploading || save.isPending} onClick={() => fileRef.current?.click()} data-testid="button-replace-photo">
                  {photoUrl ? 'Replace picture' : 'Add picture'}
                </button>
              </div>
            </div>
            <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp" aria-label="Upload profile picture" disabled={uploading || save.isPending} onChange={e => pickPhoto(e.target.files?.[0])} data-testid="input-photo" />
            <p className="ch-note">One JPEG, PNG or WebP image, up to 5 MiB. A new upload replaces the previous picture. New pictures are reviewed before other people can see them.</p>
            {upErr && <div className="ch-err" role="alert">{upErr}</div>}
          </section>
          <section className="ch-profile-identity" aria-label="Race and job">
            <b>Race and Job</b>
            <label>Race
              <select value={race} disabled aria-label="Race" data-testid="select-player-race"><option value="Human">Human</option></select>
            </label>
            <label>Job
              <select value={job} onChange={e => { setJob(e.target.value as StarterJob | ''); setSaved(false); }} aria-label="Job" data-testid="select-player-job">
                <option value="">No job yet</option>
                {STARTER_JOBS.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            {social.isError && <div className="ch-err" role="alert">{errMessage(social.error)}</div>}
          </section>
          {save.isError && <div className="ch-err" role="alert">{errMessage(save.error)}</div>}
          {saveSocial.isError && <div className="ch-err" role="alert">{errMessage(saveSocial.error)}</div>}
          {formErr && <div className="ch-err" role="alert">{formErr}</div>}
          {saved && <p role="status">Saved.</p>}
          <p><button type="submit" className="bm-btn bm-btn-primary" disabled={save.isPending || saveSocial.isPending || uploading} data-testid="button-save-identity">
            {save.isPending || saveSocial.isPending ? 'Saving...' : profile ? 'Save changes' : 'Create profile'}</button></p>
        </form>
      )}
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
