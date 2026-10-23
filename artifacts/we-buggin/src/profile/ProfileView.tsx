import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, Pencil, MoreVertical, Ban, Flag, Undo2 } from 'lucide-react';
import type { SocialPerson } from '@workspace/api-client-react';
import { UserPhoto, photoSrc } from '@/components/user-photo';
import { ShinyName } from '@/components/ShinyName';
import { BotShield } from '@/chat/BotShield';
import { BadgeMark, CoinAmount } from '@/social/common';
import { BadgeArt } from '@/social/BadgeArt';
import { SafetyReportDialog } from '@/safety/SafetyReportDialog';
import './profile.css';
import { approvedPhotos } from './profile-model';

type EarnedBadge = { id: string; earnedAt?: string | null };
type Product = { id: string; name: string };

const num = (n?: number) => (typeof n === 'number' ? n.toLocaleString() : '\u2014');
const dateOf = (s?: string | null) => (s && !isNaN(Date.parse(s)) ? new Date(s).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : null);

function Slide({ url, name, username }: { url: string | null; name: string; username: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) return <div className="pf-slide"><img src={photoSrc(url)} alt={`${name} profile photo`} onError={() => setFailed(true)} /></div>;
  return <div className="pf-slide pf-slide-empty"><UserPhoto username={username} displayName={name} photoUrl={null} size={132} /></div>;
}

export function Hero({ urls, name, username, left, right, countryBadge }: { urls: string[]; name: string; username: string; left: ReactNode; right?: ReactNode; countryBadge?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const slides: (string | null)[] = urls.length ? urls : [null];
  return (
    <div className={`pf-hero${countryBadge ? ' pf-hero-with-country' : ''}`}>
      <div className="pf-track" ref={ref} tabIndex={slides.length > 1 ? 0 : -1} aria-label="Profile photos, swipe for more"
        onScroll={(e) => { const el = e.currentTarget; setIdx(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}>
        {slides.map((u, i) => <Slide key={u ?? 'none'} url={u} name={name} username={username} />)}
      </div>
      <div className="pf-hero-bar">{left}{right}</div>
      {countryBadge}
      {slides.length > 1 && <div className="pf-dots" role="tablist" aria-label="Photo position">
        {slides.map((u, i) => <button key={u ?? i} type="button" role="tab" aria-selected={i === idx} aria-label={`Photo ${i + 1} of ${slides.length}`} className={i === idx ? 'is-on' : ''}
          onClick={() => ref.current?.scrollTo({ left: i * ref.current.clientWidth, behavior: 'smooth' })} />)}
      </div>}
    </div>
  );
}

export function BackButton({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="pf-round" aria-label={label} data-testid="link-profile-back"><ArrowLeft size={20} aria-hidden /></Link>;
}

export function ProfileMenu({ name, username, blocked, pending, onBlock }: { name: string; username: string; blocked: boolean; pending: boolean; onBlock: (active: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [dlg, setDlg] = useState<null | 'block'>(null);
  const [reportOpen, setReportOpen] = useState(false);
  useEffect(() => {
    if (!open && !dlg && !reportOpen) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setDlg(null); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, dlg, reportOpen]);
  return (
    <div className="pf-menu">
      <button type="button" className="pf-round" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="button-profile-menu"><MoreVertical size={20} aria-hidden /></button>
      {open && <>
        <button type="button" className="pf-scrim" aria-label="Close menu" tabIndex={-1} onClick={() => setOpen(false)} />
        <div className="pf-menu-list" role="menu">
          <button type="button" role="menuitem" autoFocus onClick={() => { setOpen(false); setReportOpen(true); }} data-testid="button-report"><Flag size={16} aria-hidden /> Report</button>
          {blocked
            ? <button type="button" role="menuitem" disabled={pending} onClick={() => { setOpen(false); onBlock(false); }} data-testid="button-unblock"><Undo2 size={16} aria-hidden /> Unblock</button>
            : <button type="button" role="menuitem" onClick={() => { setOpen(false); setDlg('block'); }} data-testid="button-block"><Ban size={16} aria-hidden /> Block</button>}
        </div>
      </>}
      {dlg === 'block' && <div className="pf-modal">
        <button type="button" className="pf-scrim pf-scrim-dim" aria-label="Close dialog" tabIndex={-1} onClick={() => setDlg(null)} />
        <div className="pf-dialog" role="dialog" aria-modal="true" aria-labelledby="pf-dlg-t">
          <>
            <h2 id="pf-dlg-t">Block {name}?</h2>
            <p>Blocking stops direct messages and whispers both ways and hides each other’s public room chat. It does not remove or mute either person in a room.</p>
            <div className="pf-dlg-acts">
              <button type="button" className="pf-btn pf-btn-fill" autoFocus disabled={pending} onClick={() => { onBlock(true); setDlg(null); }} data-testid="button-confirm-block">Yes, block</button>
              <button type="button" className="pf-btn" onClick={() => setDlg(null)}>Cancel</button>
            </div>
          </>
        </div>
      </div>}
      {reportOpen && <SafetyReportDialog targetType="user" targetUsername={username}
        onClose={() => setReportOpen(false)} />}
    </div>
  );
}

function Shield({ id, name, imageUrl, date, equipped }: { id: string; name: string; imageUrl?: string | null; date: string | null; equipped: boolean }) {
  return (
    <li className={`pf-badge${equipped ? ' is-equipped' : ''}`} data-testid={`badge-${id}`}>
      <span className="pf-shield" aria-hidden="true">
        <BadgeArt id={id} name={name} imageUrl={imageUrl} size={64} />
      </span>
      <b>{name}</b>
      {equipped && <small className="pf-equipped-label">Equipped</small>}
      {!equipped && date && <time className="pf-badge-date">{`Acquired ${date}`}</time>}
      {equipped && date && <time className="pf-badge-date">{date}</time>}
    </li>
  );
}

export function ProfileView({ person, own = false, countryName, products, backHref, menu, actions, links, children }: {
  person: SocialPerson; own?: boolean; countryName?: string; products?: Product[]; backHref: string;
  menu?: ReactNode; actions?: ReactNode; links?: ReactNode; children?: ReactNode;
}) {
  const p = person;
  const name = p.displayName?.trim() || p.username;
  const nameOf = (id: string) => products?.find((x) => x.id === id)?.name ?? 'Badge';
  const earned: EarnedBadge[] = [...(p.badges ?? [])];
  if (p.badgeId && !earned.some((b) => b.id === p.badgeId)) earned.push({ id: p.badgeId, earnedAt: null });
  earned.sort((a, b) => (a.id === p.badgeId ? -1 : 0) - (b.id === p.badgeId ? -1 : 0) || (Date.parse(b.earnedAt ?? '') || 0) - (Date.parse(a.earnedAt ?? '') || 0));
  const bio = p.bio?.trim();
  return (
    <div className="beam-app pf" data-testid="profile-view">
      <Hero urls={approvedPhotos(p, own)} name={name} username={p.username}
        left={<BackButton href={backHref} label="Back" />}
        right={own ? <Link href="/user-portal/edit" className="pf-round" aria-label="Edit your profile" data-testid="link-edit-hero"><Pencil size={18} aria-hidden /></Link> : menu} />
      <section className="pf-panel">
        <h1 className="pf-name" data-testid="text-display-name">
          <BadgeMark id={p.badgeId ?? null} label={p.badgeName} imageUrl={p.badgeImage} size={26} />
          <ShinyName className="pf-display-name" displayNameColor={p.displayNameColor} displayNameTierIndex={p.displayNameTierIndex}>{name}</ShinyName>
        </h1>
        {own && <Link href="/user-portal/edit" className="pf-edit" data-testid="link-edit-profile">Edit your profile</Link>}
        {actions}
        <div className="pf-chips">
          <span className="pf-chip" data-testid="text-public-id">ID @{p.username}</span>
          {p.country && <span className="pf-chip">{countryName ?? p.country}</span>}
        </div>
        {p.interests.length > 0 && <ul className="pf-chips pf-interests" aria-label="Interests">{p.interests.map((i) => <li key={i} className="pf-chip pf-chip-soft">{i}</li>)}</ul>}
        {earned.length > 0 && <>
          <h2 className="pf-h2">Badges</h2>
          <ul className="pf-badges">{earned.map((b) => <Shield key={b.id} id={b.id} name={nameOf(b.id)} imageUrl={p.badgeImage} date={dateOf(b.earnedAt)} equipped={b.id === p.badgeId} />)}</ul>
        </>}
        {bio && <p className="pf-bio" data-testid="text-bio">{bio}</p>}
        {/* Own Me page: tools and XP sit above the stats so the panel ends on coin stats. */}
        {own && children}
        {own && links}
        <dl className="pf-stats" data-testid="list-profile-stats">
          <div><dd data-testid="text-followers">{num(p.followerCount)}</dd><dt>Followers</dt></div>
          <div><dd data-testid="text-following">{num(p.followingCount)}</dd><dt>Following</dt></div>
          <div><dd data-testid="text-received"><CoinAmount>{num(p.receivedCredits)}</CoinAmount></dd><dt>Coins received in gifts</dt></div>
          <div><dd data-testid="text-sent"><CoinAmount>{num(p.sentCredits)}</CoinAmount></dd><dt>Coins sent in gifts</dt></div>
        </dl>
        {!own && children}
        {!own && links}
      </section>
    </div>
  );
}

export const BOTS: Record<string, string> = { ghost: 'Ghost Bot', vampire: 'Vampire Bot', wolf: 'Wolf Bot', zombie: 'Zombie Bot' };

export function BotProfile({ botId }: { botId: string }) {
  const name = Object.prototype.hasOwnProperty.call(BOTS, botId) ? BOTS[botId] : null;
  if (!name) return <div className="pf"><div className="pf-panel pf-panel-solo"><h1 className="pf-name">Bot not found</h1><Link href="/home" className="pf-btn">Back to rooms</Link></div></div>;
  return (
    <div className="pf" data-testid={`profile-bot-${botId}`}>
      <Hero urls={[`/bots/${botId}.webp`]} name={name} username={botId} left={<BackButton href="/home" label="Back" />} />
      <section className="pf-panel">
        <h1 className="pf-name">{name} <BotShield botId={botId} /></h1>
      </section>
    </div>
  );
}
