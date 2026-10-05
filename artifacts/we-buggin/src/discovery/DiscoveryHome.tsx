import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Heart, House, MessageCircle, UserRound, Video, Hash } from 'lucide-react';
import { useGetMyProfile } from '@workspace/api-client-react';
import { useBeamState } from '@/beam/hooks/useBeam';
import { IdentityGlyph } from '@/beam/components/IdentityGlyph';
import type { BeamRoom } from '@/beam/types';
import '@/beam/beam.css';
import './discovery.css';

type Tab = 'home' | 'follow' | 'messages';
type Store = 'ok' | 'unavailable' | 'corrupt' | 'full';

const keyFor = (userId: string) => `webuggin:discovery:follows:${userId}`;

function useFollows(userId: string) {
  const [codes, setCodes] = useState<string[]>([]);
  const [store, setStore] = useState<Store>('ok');
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(keyFor(userId));
      if (!raw) { setCodes([]); setStore('ok'); return; }
      const v = JSON.parse(raw);
      if (!Array.isArray(v) || v.length > 256 || !v.every((x) => typeof x === 'string' && /^[A-Z0-9]{6}$/.test(x))) throw new Error('bad');
      setCodes(v); setStore('ok');
    } catch (e) {
      setCodes([]);
      setStore(e instanceof SyntaxError || (e instanceof Error && e.message === 'bad') ? 'corrupt' : 'unavailable');
    }
  }, [userId]);
  const toggle = useCallback((code: string) => {
    if (!codes.includes(code) && codes.length >= 256) { setStore('full'); return; }
    const next = codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code];
    setCodes(next);
    try { window.localStorage.setItem(keyFor(userId), JSON.stringify(next)); setStore('ok'); } catch { setStore('unavailable'); }
  }, [userId, codes]);
  const reset = useCallback(() => {
    try { window.localStorage.removeItem(keyFor(userId)); setStore('ok'); } catch { setStore('unavailable'); }
    setCodes([]);
  }, [userId]);
  return { codes, store, toggle, reset };
}

function RoomCard({ room, own, followed, onToggle }: { room: BeamRoom; own: boolean; followed: boolean; onToggle: () => void }) {
  const full = room.participants.length >= room.capacity;
  const blocked = full && !own;
  const host = room.participants[0];
  const body = (
    <>
      <span className="dh-demo">Demo</span>
      {host && <span className="dh-art"><IdentityGlyph identity={host.identity} size="100%" /></span>}
      <span className="dh-meta">
        <span className="dh-name">{room.name}</span>
        <span className="dh-sub">{room.code} · {room.participants.length}/{room.capacity} participants {full && <b className="dh-full">Full</b>}</span>
      </span>
    </>
  );
  return (
    <article className={`dh-card${blocked ? ' is-full' : ''}`} data-testid={`card-room-${room.code}`}>
      {blocked ? (
        <div className="dh-card-link is-disabled" role="link" aria-disabled="true" aria-label={`${room.name}, full`}>{body}</div>
      ) : (
        <Link href={`/beams/${room.code}`} className="dh-card-link" aria-label={`Open ${room.name}`}>{body}</Link>
      )}
      <button type="button" className="dh-follow" aria-pressed={followed} aria-label={followed ? `Unfollow ${room.name}` : `Follow ${room.name}`} onClick={onToggle} data-testid={`button-follow-${room.code}`}>
        <Heart size={22} fill={followed ? 'currentColor' : 'none'} />
      </button>
    </article>
  );
}

export default function DiscoveryHome({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>('home');
  const state = useBeamState();
  const profileQ = useGetMyProfile();
  const { codes, store, toggle, reset } = useFollows(userId);
  const rooms = useMemo(() => Object.values(state.rooms).sort((a, b) => b.createdAt - a.createdAt), [state.rooms]);
  const shown = (tab === 'follow' ? rooms.filter((r) => codes.includes(r.code)) : rooms).slice(0, 24);
  const profile = profileQ.data?.profile ?? null;

  useEffect(() => {
    document.title = 'Home — We Buggin';
    return () => { document.title = 'We Buggin'; };
  }, []);

  const navBtn = (t: Tab, label: string, icon: ReactNode) => (
    <button type="button" className="dh-nav-item" aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)} data-testid={`nav-${t}`}>{icon}{label}</button>
  );

  return (
    <div className="beam-app dh">
      <div className="bm-bg" aria-hidden="true"><i /><i /><i /></div>
      <main className="dh-wrap">
        <div className="dh-top">
          <div className="dh-tabs">
            {tab === 'messages' ? <span>Messages</span> : (
              <>
                <button type="button" className={tab === 'home' ? 'is-on' : ''} aria-pressed={tab === 'home'} onClick={() => setTab('home')}>Live</button>
                <button type="button" className={tab === 'follow' ? 'is-on' : ''} aria-pressed={tab === 'follow'} onClick={() => setTab('follow')}>Following</button>
              </>
            )}
          </div>
          <Link href="/beams/join" className="bm-btn bm-btn-sm dh-join" data-testid="link-join-code"><Hash size={16} /> Join by code</Link>
        </div>

        {profileQ.isLoading && <div className="dh-skel" data-testid="status-loading" />}
        {profileQ.isError && (
          <div className="dh-banner" role="alert">
            <p>Could not load your profile.</p>
            <button type="button" className="bm-btn bm-btn-sm" onClick={() => profileQ.refetch()} data-testid="button-retry-profile">Retry</button>
          </div>
        )}
        {profileQ.data && (profile ? (
          <div className="dh-banner"><p className="bm-label">Signed in</p><h2 data-testid="text-greeting">Hey, {profile.username}</h2></div>
        ) : (
          <div className="dh-banner">
            <h2>Welcome</h2>
            <p className="bm-lede">Claim your name to start rooms with friends.</p>
            <Link href="/user-portal" className="bm-btn bm-btn-primary" data-testid="link-claim-name">Claim your name</Link>
          </div>
        ))}

        {tab !== 'messages' && (
          <>
            <h2 className="dh-h">{tab === 'home' ? 'Demo rooms on this device' : 'Rooms you follow'}</h2>
            {store !== 'ok' && (
              <div className="dh-banner" role="alert">
                <p>{store === 'corrupt' ? 'Saved follows were unreadable.' : store === 'full' ? 'You can follow up to 256 demo rooms on this device. Unfollow a room before adding another.' : 'Browser storage is unavailable, so follows will not be saved.'}</p>
                {store === 'corrupt' && <button type="button" className="bm-btn bm-btn-sm" onClick={reset}>Reset follows</button>}
              </div>
            )}
            {shown.length === 0 ? (
              <div className="dh-empty">
                <p>{tab === 'home' ? 'No rooms exist in this browser yet.' : 'You are not following any rooms. Tap the heart on a room in Home.'}</p>
                {tab === 'home' ? <Link href="/beams/new" className="bm-btn bm-btn-primary">Start a room</Link> : <button type="button" className="bm-btn" onClick={() => setTab('home')}>Browse rooms</button>}
              </div>
            ) : (
              <div className="dh-grid">
                {shown.map((r) => (
                  <RoomCard key={r.code} room={r} own={state.session?.code === r.code} followed={codes.includes(r.code)} onToggle={() => toggle(r.code)} />
                ))}
              </div>
            )}
            <p className="dh-note">Beams opened in this session appear here. Chat and moods are shared; follows are saved on this device for your account.</p>
          </>
        )}

        {tab === 'messages' && (
          <div className="dh-empty">
            <p>No direct messages here. Messages happen inside a beam, with everyone in the room.</p>
            <Link href="/beams/join" className="bm-btn">Join with a link or code</Link>
          </div>
        )}
      </main>

      <nav className="dh-nav" aria-label="Main">
        <ul>
          <li>{navBtn('home', 'Home', <House size={24} />)}</li>
          <li>{navBtn('follow', 'Follow', <Heart size={24} />)}</li>
          <li><Link href="/beams/new" className="dh-nav-go" aria-label="Go live: start a beam" data-testid="link-start"><Video size={28} /></Link></li>
          <li>{navBtn('messages', 'Messages', <MessageCircle size={24} />)}</li>
          <li><Link href="/user-portal" className="dh-nav-item" data-testid="link-me"><UserRound size={24} />Me</Link></li>
        </ul>
      </nav>
    </div>
  );
}
