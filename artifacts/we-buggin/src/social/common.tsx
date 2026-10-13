import { useRef, type ReactNode } from 'react';
import { Link } from 'wouter';
import type { QueryClient } from '@tanstack/react-query';
import { Award, Crown, Flame, Gem, Gift, Heart, Rocket, Sparkles, Star, Zap, Coins, type LucideIcon } from 'lucide-react';
import type { SocialPerson } from '@workspace/api-client-react';
import { UserPhoto } from '@/components/user-photo';

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
export function BadgeMark({ id, label, imageUrl, size = 14, compact = false }: {
  id: string | null; label?: string | null; imageUrl?: string | null; size?: number; compact?: boolean;
}) {
  if (!id) return null;
  const tier = /^monthly-tier-([1-5])$/.exec(id)?.[1];
  if (!tier) return null;
  const badgeName = label ?? `Monthly purchase tier ${tier}`;
  return <span className={`sc-badge${compact ? ' sc-badge-compact' : ''}`} title={badgeName}
    style={{ width: size, height: size }} data-badge-tier={tier}>
    <img src={imageUrl ? `${import.meta.env.BASE_URL}${imageUrl.replace(/^\/+/, '')}`
      : `${import.meta.env.BASE_URL}badges/monthly-credit-tiers/tier${tier}${['2', '3', '4'].includes(tier) ? '.png' : '.svg'}`}
      width={size} height={size} alt="" aria-hidden="true" />
    <span className="sc-sr">{badgeName}</span>
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
export const Avatar = ({ p, size = 56 }: { p: PhotoPerson; size?: number }) => (
  <UserPhoto username={p.username} displayName={p.displayName} photoUrl={p.photoUrl} size={size}
    reviewStatus={p.photoReviews?.find(photo => photo.photoUrl === p.photoUrl)?.status} />
);

export function PersonCard({ p, extra }: { p: SocialPerson; extra?: ReactNode }) {
  return (
    <article className="sc-card" data-testid={`card-person-${p.username}`}>
      <Link href={`/community/people/${p.username}`} className="sc-card-main">
        <Avatar p={p} size={64} />
        <span className="sc-card-text">
          <span className="sc-name" style={{ color: p.displayNameColor ?? '#FFFFFF' }}>
            <BadgeMark id={p.badgeId} label={p.badgeName} imageUrl={p.badgeImage} size={18} compact />{(p as PhotoPerson).displayName || p.username}
          </span>
          <span className="sc-sub">@{p.username}{p.country ? ` / ${p.country}` : ''}</span>
          {p.bio && <span className="sc-bio">{p.bio}</span>}
          {p.interests.length > 0 && <span className="sc-tags">{p.interests.slice(0, 4).map((i) => <i key={i}>{i}</i>)}</span>}
        </span>
      </Link>
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
