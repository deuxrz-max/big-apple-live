import { useRef, type ReactNode } from 'react';
import { Link } from 'wouter';
import type { QueryClient } from '@tanstack/react-query';
import { Award, Crown, Flame, Gem, Gift, Heart, Rocket, Sparkles, Star, Zap, Coins, type LucideIcon } from 'lucide-react';
import type { SocialPerson } from '@workspace/api-client-react';
import { UserPhoto } from '@/components/user-photo';
import { ProfileTap } from '@/profile/QuickProfile';
import { ShinyName } from '@/components/ShinyName';

export function errMsg(e: unknown): string {
  const x = e as { data?: { error?: string } | null; message?: string };
  return x?.data?.error ?? x?.message ?? 'Something went wrong.';
}
export const errStatus = (e: unknown): number | undefined => (e as { status?: number })?.status;

export function refreshSocial(qc: QueryClient) {
  return qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/api/social') });
}

const ICONS: LucideIcon[] = [Star, Award, Crown, Gem, Heart, Sparkles, Flame, Rocket, Zap];
export function iconFor(id: string): LucideIcon {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ICONS[h % ICONS.length];
}
export function GiftIcon({ id, size = 22 }: { id: string; size?: number }) {
  const I = id.toLowerCase().includes('coin') ? Coins : iconFor(id + 'g') ?? Gift;
  return <I size={size} aria-hidden />;
}

export function CoinAmount({ children, size = 14, className }: {
  children: ReactNode; size?: number; className?: string;
}) {
  return <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
    <Coins size={size} aria-hidden="true" style={{ color: '#f5cb8d', flex: '0 0 auto' }} />
    {children}
  </span>;
}

/** Keeps one idempotency key per identical operation until confirmed. */
export function useIdemKey() {
  const ref = useRef<{ sig: string; key: string } | null>(null);
  return {
    get(sig: string) {
      if (!ref.current || ref.current.sig !== sig) ref.current = { sig, key: crypto.randomUUID() };
      return ref.current.key;
    },
    clear() { ref.current = null; },
  };
}

type PhotoPerson = { username: string; photoUrl?: string | null; displayName?: string | null; photoReviews?: { photoUrl: string; status: string }[] };
export const Avatar = ({ p, size = 56, tap = true }: { p: PhotoPerson; size?: number; tap?: boolean }) => (
  tap ? <ProfileTap username={p.username}><UserPhoto username={p.username} displayName={p.displayName} photoUrl={p.photoUrl} size={size}
    reviewStatus={p.photoReviews?.find(photo => photo.photoUrl === p.photoUrl)?.status} /></ProfileTap> :
  <UserPhoto username={p.username} displayName={p.displayName} photoUrl={p.photoUrl} size={size}
    reviewStatus={p.photoReviews?.find(photo => photo.photoUrl === p.photoUrl)?.status} />
);

export function PersonCard({ p, extra, className = '', publicSearch = false }: {
  p: SocialPerson; extra?: ReactNode; className?: string; publicSearch?: boolean;
}) {
  return (
    <article className={`sc-card${className ? ` ${className}` : ''}`} data-testid={`card-person-${p.username}`}>
      <div className="sc-card-main">
        <Avatar p={p} size={64} />
        <Link href={`/community/people/${p.username}`} className="sc-card-text" data-testid={`link-person-${p.username}`}>
          <ShinyName className="sc-name" displayNameColor={p.displayNameColor} displayNameTierIndex={p.displayNameTierIndex}>
            <span className="sc-name-label">{(p as PhotoPerson).displayName || p.username}</span>
          </ShinyName>
          <span className="sc-sub">@{p.username}{!publicSearch && p.country ? ` / ${p.country}` : ''}</span>
          {publicSearch && <span className="sc-sub">Level {p.displayNameTierIndex ?? 0}</span>}
          {!publicSearch && p.bio && <span className="sc-bio">{p.bio}</span>}
          {!publicSearch && p.interests.length > 0 && <span className="sc-tags">{p.interests.slice(0, 4).map((i) => <i key={i}>{i}</i>)}</span>}
        </Link>
      </div>
      {extra}
    </article>
  );
}

export const Loading = () => <div className="sc-skel" role="status" aria-label="Loading" data-testid="status-loading"><i /><i /><i /></div>;
export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="sc-note is-err" role="alert">
      <p>{errMsg(error)}</p>
      {retry && <button type="button" className="bm-btn bm-btn-sm" onClick={retry}>Retry</button>}
    </div>
  );
}
export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="sc-empty"><h2>{title}</h2>{children}</div>
);
export const Msg = ({ ok, children }: { ok?: boolean; children: ReactNode }) => (
  <p className={`sc-note ${ok ? 'is-ok' : 'is-err'}`} role={ok ? 'status' : 'alert'}>{children}</p>
);
export const fmt = (s: string) => new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
