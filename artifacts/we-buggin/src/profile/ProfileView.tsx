import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useClerk } from '@clerk/react';
import { ArrowLeft, MoreVertical, Ban, Flag, Undo2, Store, Pencil } from 'lucide-react';
import type { SocialPerson } from '@workspace/api-client-react';
import { BotShield } from '@/chat/BotShield';
import { SafetyReportDialog } from '@/safety/SafetyReportDialog';
import { ProfileCard } from './ProfileCard';
import { GameGem } from '@/components/game-gem';
import './profile.css';
import './profile-card.css';
import { useProfileBackHref } from './QuickProfile';

export function BackButton({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="pf-round" aria-label={label} data-testid="link-profile-back"><ArrowLeft size={20} aria-hidden /></Link>;
}

export function ProfileMenu({ name, username, blocked, pending, onBlock }: {
  name: string; username: string; blocked: boolean; pending: boolean; onBlock: (active: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dlg, setDlg] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  useEffect(() => {
    if (!open && !dlg && !reportOpen) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setDlg(false); setReportOpen(false); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, dlg, reportOpen]);
  return (
    <div className="pf-menu">
      <button type="button" className="pf-round" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} data-testid="button-profile-menu"><MoreVertical size={20} aria-hidden /></button>
      {open && <>
        <button type="button" className="pf-scrim" aria-label="Close menu" tabIndex={-1} onClick={() => setOpen(false)} />
        <div className="pf-menu-list" role="menu">
          <button type="button" role="menuitem" autoFocus onClick={() => { setOpen(false); setReportOpen(true); }} data-testid="button-report"><Flag size={16} aria-hidden /> Report</button>
          {blocked
            ? <button type="button" role="menuitem" disabled={pending} onClick={() => { setOpen(false); onBlock(false); }} data-testid="button-unblock"><Undo2 size={16} aria-hidden /> Unblock</button>
            : <button type="button" role="menuitem" onClick={() => { setOpen(false); setDlg(true); }} data-testid="button-block"><Ban size={16} aria-hidden /> Block</button>}
        </div>
      </>}
      {dlg && <div className="pf-modal">
        <button type="button" className="pf-scrim pf-scrim-dim" aria-label="Close dialog" tabIndex={-1} onClick={() => setDlg(false)} />
        <div className="pf-dialog" role="dialog" aria-modal="true" aria-labelledby="pf-dlg-t">
          <h2 id="pf-dlg-t">Block {name}?</h2>
          <p>Blocking stops direct messages and whispers both ways and hides each other’s public room chat. It does not remove or mute either person in a room.</p>
          <div className="pf-dlg-acts">
            <button type="button" className="pf-btn pf-btn-fill" autoFocus disabled={pending} onClick={() => { onBlock(true); setDlg(false); }} data-testid="button-confirm-block">Yes, block</button>
            <button type="button" className="pf-btn" onClick={() => setDlg(false)}>Cancel</button>
          </div>
        </div>
      </div>}
      {reportOpen && <SafetyReportDialog targetType="user" targetUsername={username} onClose={() => setReportOpen(false)} />}
    </div>
  );
}

export function ProfileView({ person, own = false, backHref, menu, actions }: {
  person: SocialPerson; own?: boolean; backHref: string; menu?: ReactNode; actions?: ReactNode;
}) {
  const { signOut } = useClerk();
  const name = person.displayName?.trim() || person.username;
  return (
    <div className="beam-app pf pf-clean" data-testid="profile-view">
      <header className="pf-clean-header">
        <BackButton href={backHref} label="Back" />
        <strong><GameGem color="red" size={22} /> {own ? 'Me' : 'Profile'}</strong>
        {menu ?? (own ? <Link href="/user-portal/edit" className="pf-round" aria-label="Edit profile" data-testid="link-edit-profile">Edit</Link> : <span />)}
      </header>
      <div
        className="pf-clean-card"
        style={{ '--profile-square-art': `url("${import.meta.env.BASE_URL}battle-assets/cards/profile-square-card.jpg")` } as CSSProperties}
      >
        <ProfileCard person={person} />
        {own && <Link className="pf-edit-card-link" href="/user-portal/edit" aria-label="Edit profile" data-testid="link-edit-card"><Pencil size={17} aria-hidden /></Link>}
      </div>
      {own ? (
        <div className="pf-own-actions">
          <Link href="/user-portal/store" className="pf-btn pf-store-button" data-testid="link-profile-store"><Store size={18} aria-hidden /> Store</Link>
          <div className="pf-future-action-space" aria-hidden="true" />
          <button type="button" className="pf-btn pf-signout-button" onClick={() => signOut({ redirectUrl: import.meta.env.BASE_URL || '/' })} data-testid="button-profile-sign-out">Sign Out</button>
        </div>
      ) : actions ? <div className="pf-clean-actions">{actions}</div> : null}
    </div>
  );
}

export const BOTS: Record<string, string> = { ghost: 'Ghost Bot', vampire: 'Vampire Bot', wolf: 'Wolf Bot', zombie: 'Zombie Bot' };
export function BotProfile({ botId }: { botId: string }) {
  const name = Object.prototype.hasOwnProperty.call(BOTS, botId) ? BOTS[botId] : null;
  if (!name) return <div className="pf"><div className="pf-panel pf-panel-solo"><h1 className="pf-name">Bot not found</h1><Link href="/home" className="pf-btn">Back to rooms</Link></div></div>;
  return <div className="pf" data-testid={`profile-bot-${botId}`}><BackButton href="/home" label="Back" /><h1 className="pf-name">{name} <BotShield botId={botId} /></h1></div>;
}
