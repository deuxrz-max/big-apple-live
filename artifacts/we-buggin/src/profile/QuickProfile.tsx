import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { X } from 'lucide-react';
import { getGetSocialPersonQueryKey, useGetSocialPerson } from '@workspace/api-client-react';
import { UserPhoto } from '@/components/user-photo';
import { ShinyName } from '@/components/ShinyName';

/**
 * Shared quick-profile mechanism.
 * - QuickProfileProvider (mounted once in App) renders a single overlay sheet.
 * - useQuickProfile().open(username) opens it; close() dismisses without touching the route.
 * - <ProfileTap username> wraps any profile photo; a tap (not a swipe/drag) opens the sheet and
 *   stops propagation so parent links, seat buttons and mic toggles never fire.
 */
type Ctx = {
  open: (username: string) => void; close: () => void; username: string | null;
  /** Route the user was on when they chose "View full profile" (in-memory, per profile). */
  originFor: (username: string) => string | null;
};
const QuickProfileContext = createContext<Ctx | null>(null);

export function useQuickProfile() {
  return useContext(QuickProfileContext);
}

/** Back target for a full profile page: the exact originating route, else the fallback. */
export function useProfileBackHref(username: string | undefined, fallback: string) {
  const qp = useQuickProfile();
  return (username && qp?.originFor(username)) || fallback;
}

export function QuickProfileProvider({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [username, setUsername] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const origins = useRef(new Map<string, string>());
  const prevLocation = useRef(location);
  const open = useCallback((u: string) => {
    if (!u) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setUsername(u);
  }, []);
  const close = useCallback(() => setUsername(null), []);
  const originFor = useCallback((u: string) => origins.current.get(u.toLowerCase()) ?? null, []);
  // Close the sheet if the route changes underneath it (e.g. browser back).
  useEffect(() => {
    if (prevLocation.current !== location) {
      setUsername(null);
      // Any navigation into a full profile remembers where it came from (in-memory history helper).
      const m = location.match(/^\/community\/people\/([^/?#]+)/);
      if (m && !prevLocation.current.startsWith('/community/people/')) {
        origins.current.set(decodeURIComponent(m[1]).toLowerCase(), prevLocation.current);
      }
    }
    prevLocation.current = location;
  }, [location]);
  const goFull = useCallback((u: string) => {
    origins.current.set(u.toLowerCase(), `${location}${window.location.search}`);
  }, [location]);
  const value = useMemo(() => ({ open, close, username, originFor }), [open, close, username, originFor]);
  return (
    <QuickProfileContext.Provider value={value}>
      {children}
      {username && <QuickProfileSheet key={username} username={username} opener={opener.current} onClose={close} onFull={() => goFull(username)} />}
    </QuickProfileContext.Provider>
  );
}

function QuickProfileSheet({ username, onClose, onFull, opener }: { username: string; onClose: () => void; onFull: () => void; opener: HTMLElement | null }) {
  const q = useGetSocialPerson(username, { query: { queryKey: getGetSocialPersonQueryKey(username) } });
  const p = q.data;
  const name = p?.displayName?.trim() || p?.username || username;
  const sheetRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Escape to close, Tab focus trap, restore focus to the opener, body scroll lock (safe cleanup).
  useEffect(() => {
    const body = document.body;
    const prevOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const items = Array.from(sheetRef.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (!sheetRef.current.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', k, true);
    return () => {
      window.removeEventListener('keydown', k, true);
      body.style.overflow = prevOverflow;
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="qp-root" data-testid="sheet-quick-profile" data-username={username}
      onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" className="qp-scrim" aria-label="Close profile" tabIndex={-1} onClick={onClose} data-testid="button-quick-profile-scrim" />
      <section className="qp-sheet" role="dialog" aria-modal="true" aria-labelledby="qp-title" ref={sheetRef}>
        <button type="button" className="qp-x" aria-label="Close profile" autoFocus onClick={onClose} data-testid="button-quick-profile-close"><X size={20} aria-hidden /></button>
        {q.isLoading ? (
          <div className="qp-body" aria-busy="true" data-testid="status-quick-profile-loading">
            <strong id="qp-title">@{username}</strong>
            <span className="qp-skel qp-skel-photo" /><span className="qp-skel qp-skel-line" /><span className="qp-skel qp-skel-line short" />
          </div>
        ) : q.isError || !p ? (
          <div className="qp-body" role="alert" data-testid="status-quick-profile-error">
            <strong id="qp-title">Profile unavailable</strong>
            <span className="qp-sub">@{username}</span>
            <button type="button" className="qp-btn" onClick={() => q.refetch()} data-testid="button-quick-profile-retry">Try again</button>
          </div>
        ) : (
          <div className="qp-body">
            <UserPhoto username={p.username} displayName={p.displayName} photoUrl={p.photoUrl} size={96} />
            <strong id="qp-title" className="qp-name" data-testid="text-quick-profile-name">
              <ShinyName displayNameColor={p.displayNameColor} displayNameTierIndex={p.displayNameTierIndex}>{name}</ShinyName>
            </strong>
            <span className="qp-sub" data-testid="text-quick-profile-username">@{p.username}{p.country ? ` / ${p.country}` : ''}</span>
            {p.bio?.trim() && <p className="qp-bio">{p.bio.trim()}</p>}
            <dl className="qp-stats">
              <div><dd>{(p.followerCount ?? 0).toLocaleString()}</dd><dt>Followers</dt></div>
              <div><dd>{(p.followingCount ?? 0).toLocaleString()}</dd><dt>Following</dt></div>
            </dl>
          </div>
        )}
        <div className="qp-actions">
          <Link href={`/community/people/${encodeURIComponent(username)}`} className="qp-btn qp-btn-fill" onClick={() => { onFull(); onClose(); }} data-testid="link-quick-profile-full">View full profile</Link>
          <button type="button" className="qp-btn" onClick={onClose} data-testid="button-quick-profile-dismiss">Close</button>
        </div>
      </section>
    </div>
  );
}

/** Tap-vs-swipe handlers for photo tracks that must keep their own layout. */
export function useProfileTapHandlers(username?: string | null) {
  const qp = useQuickProfile();
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  if (!qp || !username) return {};
  return {
    'data-profile-tap': username,
    onPointerDown: (e: RPointerEvent) => { start.current = { x: e.clientX, y: e.clientY }; moved.current = false; },
    onPointerMove: (e: RPointerEvent) => { if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) moved.current = true; },
    onPointerCancel: () => { moved.current = true; },
    onKeyDown: (e: { key: string; preventDefault: () => void; stopPropagation: () => void }) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation(); qp.open(username);
      }
    },
    onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation(); if (moved.current) { moved.current = false; return; } qp.open(username); },
    // Keyboard: Enter on the focused carousel opens the sheet (keyup, so existing arrow-key handlers stay intact).
    onKeyUp: (e: { key: string; target: EventTarget; currentTarget: EventTarget; stopPropagation: () => void }) => {
      if (e.key === 'Enter' && e.target === e.currentTarget) { e.stopPropagation(); qp.open(username); }
    },
  };
}

/** Wraps a profile photo. Tap opens the quick profile; swipes/drags (>10px) are ignored. */
export function ProfileTap({ username, children, className = '', label }: { username?: string | null; children: ReactNode; className?: string; label?: string }) {
  const qp = useQuickProfile();
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  if (!qp || !username) return <>{children}</>;
  const onDown = (e: RPointerEvent) => { start.current = { x: e.clientX, y: e.clientY }; moved.current = false; };
  const onMove = (e: RPointerEvent) => {
    if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) moved.current = true;
  };
  return (
    <span role="button" tabIndex={0} className={`qp-tap ${className}`.trim()} aria-label={label ?? `Open profile for ${username}`}
      data-testid={`tap-profile-photo-${username}`}
      onPointerDown={onDown} onPointerMove={onMove} onPointerCancel={() => { moved.current = true; }}
      onClick={(e) => {
        e.preventDefault(); e.stopPropagation();
        if (moved.current) { moved.current = false; return; }
        qp.open(username);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); e.stopPropagation(); qp.open(username);
      }}>
      {children}
    </span>
  );
}
