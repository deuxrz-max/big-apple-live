import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, ShieldCheck, Stamp, Trash2 } from 'lucide-react';
import {
  getGetMyStreamerPassportQueryKey,
  getGetSocialPersonStreamerPassportQueryKey,
  getGetStreamerPassportReviewQueueQueryKey,
  useDeleteMyStreamerPassportPlatform,
  useGetMyStreamerPassport,
  useGetSocialPersonStreamerPassport,
  useGetStreamerPassportReviewQueue,
  useRequestMyStreamerPassportVerification,
  useReviewStreamerPassportRequest,
  useSaveMyStreamerPassportPlatform,
  useSetStreamerPassportFoundingLeague,
  type PublicStreamerPassport,
  type StreamerPassportBadgeSummary,
  type MyStreamerPassportPlatform,
} from '@workspace/api-client-react';
import { ErrorBox, Loading } from '@/social/common';
import { IdentityAvatar } from '@/lib/identity';
import './passport.css';

const niceDate = (value?: string | null) => value && !Number.isNaN(Date.parse(value))
  ? new Date(value).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
  : 'Date not available';

function Mark({ label, color, small = false }: { label: string; color: string; small?: boolean }) {
  return <span className={`sp-mark${small ? ' sp-mark-small' : ''}`} style={{ '--platform-color': color } as CSSProperties} aria-hidden="true">{label.slice(0, 2).toUpperCase()}</span>;
}

export function PassportSummaryBadge({ passport, username, context }: { passport?: StreamerPassportBadgeSummary; username: string; context?: string }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
      if (event.key === 'Tab') {
        const dialog = modalRef.current?.querySelector<HTMLElement>('[data-passport-dialog="true"]');
        const focusable = [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]') ?? [])];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (first && last && event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (first && last && !event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
      if (!buttonRef.current?.isConnected) previous?.focus();
    };
  }, [open]);
  const query = useGetSocialPersonStreamerPassport(username, {
    query: { enabled: open && !!username, queryKey: getGetSocialPersonStreamerPassportQueryKey(username) },
  });
  if (!passport?.platforms.length) return null;
  const labels = passport.platforms.map((p) => p.label);
  const title = `Open ${username}'s streamer passport: ${labels.join(', ')}${passport.verified ? ', ownership checked by Deux Wild' : ', self-listed'}`;
  return <>
    <button ref={buttonRef} type="button" className={`sp-summary-badge${passport.verified ? ' is-checked' : ''}`} title={title} aria-label={title} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)} data-testid={`button-passport-${username}${context ? `-${context}` : ''}`}>
      <span className="sp-summary-dots" aria-hidden="true">{passport.platforms.map((p) => <i key={p.id} style={{ backgroundColor: p.color }} />)}</span>
      {passport.verified && <Check size={11} aria-hidden="true" />}
    </button>
    {open && <div ref={modalRef} className="sp-modal" data-testid={`dialog-passport-${username}`}>
      <button type="button" className="sp-modal-scrim" aria-label="Close passport" onClick={() => { setOpen(false); buttonRef.current?.focus(); }} />
      <section className="sp-modal-panel" role="dialog" aria-modal="true" aria-labelledby={`passport-title-${username}`} data-passport-dialog="true">
        <button ref={closeRef} type="button" className="sp-modal-close" onClick={() => { setOpen(false); buttonRef.current?.focus(); }} aria-label="Close passport" data-testid="button-close-passport">Close</button>
        {query.isLoading && <div className="sp-skeleton" role="status" aria-label="Loading streamer passport" data-testid="loading-badge-passport"><i /><i /><i /></div>}
        {query.isError && <div className="sp-error" role="alert" data-testid="error-badge-passport"><strong>Passport unavailable</strong><button type="button" onClick={() => void query.refetch()} data-testid="button-retry-badge-passport">Try again</button></div>}
        {query.data && <PassportCard passport={query.data} titleId={`passport-title-${username}`} />}
      </section>
    </div>}
  </>;
}

function FoundingStamp() {
  return <div className="sp-founding-stamp" data-testid="stamp-founding-league" aria-label="Founding League member">
    <span>DEUX WILD</span><strong>FOUNDING<br />LEAGUE</strong><span>ORIGINAL MEMBER</span>
  </div>;
}

function PassportIntro({ title, detail, titleId }: { title: string; detail: string; titleId?: string }) {
  return <header className="sp-intro"><div className="sp-kicker"><span /> DEUX WILD / CREATOR RECORD</div><h2 id={titleId}>{title}</h2><p>{detail}</p></header>;
}

function PassportCard({ passport, titleId }: { passport: PublicStreamerPassport; titleId?: string }) {
  return <section className="sp-card sp-public" aria-label={`${passport.displayName} streamer passport`} data-testid="card-public-passport">
    <div className="sp-person-heading" data-testid={`header-passport-${passport.username}`}>
      <span className="sp-avatar-representation"><IdentityAvatar identity={passport.identity} size={44} /></span>
      <div><strong>{passport.displayName}</strong><span>@{passport.username}</span></div>
    </div>
    {passport.foundingLeague && <FoundingStamp />}
    <PassportIntro title="Streamer passport" titleId={titleId} detail="Public creator profiles, listed by this member. A Deux Wild community record, not platform verification." />
    {passport.platforms.length ? <PlatformStamps entries={passport.platforms} /> : <div className="sp-empty" data-testid="empty-public-passport">No public creator profiles listed yet.</div>}
    <footer className="sp-footnote"><ShieldCheck size={15} aria-hidden="true" /> A Verified marker means ownership checked by Deux Wild (manual bio check). No platform login or endorsement.</footer>
  </section>;
}

function PlatformStamps({ entries, owner = false }: { entries: Array<{
  id: string; label: string; color: string; handle: string; profileUrl: string; addedAt: string;
  verified: boolean; verificationStatus?: string; verificationCode?: string; entryId?: string;
}>; owner?: boolean }) {
  return <div className="sp-stamps" data-testid="list-passport-platforms">
    {entries.map((entry) => <article className={`sp-platform-stamp${entry.verified ? ' is-verified' : ''}`} key={entry.entryId ?? entry.id} data-testid={`card-passport-platform-${entry.id}`}>
      <a className="sp-stamp-link" href={entry.profileUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${entry.label} profile for ${entry.handle} in a new tab`}>
        <span className="sp-stamp-ring" style={{ '--platform-color': entry.color } as CSSProperties}>
          <Mark label={entry.label} color={entry.color} />
          <strong>{entry.label}</strong><b>@{entry.handle}</b>
          {entry.verified && <span className="sp-verified"><Check size={12} aria-hidden="true" /> VERIFIED</span>}
          {!entry.verified && <span className="sp-selflisted">SELF-LISTED</span>}
        </span>
        <span className="sp-stamp-date">ON FILE · {niceDate(entry.addedAt)}</span>
        <ExternalLink className="sp-external" size={14} aria-hidden="true" />
      </a>
      {owner && <div className="sp-owner-actions">
        <span className={`sp-status sp-status-${entry.verificationStatus}`} data-testid={`status-passport-${entry.id}`}>
          {entry.verificationStatus === 'verified' ? 'Verified · ownership checked' : entry.verificationStatus === 'requested' ? 'Request pending' : 'Unverified'}
        </span>
        {entry.verificationCode && entry.verificationStatus !== 'verified' && <CodeCopy code={entry.verificationCode} platform={entry.id} />}
      </div>}
    </article>)}
  </div>;
}

function CodeCopy({ code, platform }: { code: string; platform: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('error');
    }
  };
  return <div className="sp-code-box" data-testid={`content-verification-code-${platform}`}>
    <span><small>PRIVATE BIO CODE</small><code>{code}</code></span>
    <button type="button" onClick={() => void copy()} aria-label={`Copy private verification code for ${platform}`} data-testid={`button-copy-code-${platform}`}><Copy size={15} />{copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy'}</button>
  </div>;
}

export function PublicStreamerPassport({ username }: { username: string }) {
  const query = useGetSocialPersonStreamerPassport(username, {
    query: { enabled: !!username, queryKey: getGetSocialPersonStreamerPassportQueryKey(username) },
  });
  if (query.isLoading) return <div className="sp-skeleton" role="status" aria-label="Loading streamer passport" data-testid="loading-public-passport"><i /><i /></div>;
  if (query.isError) return <div className="sp-error" role="alert" data-testid="error-public-passport"><strong>Passport unavailable</strong><button type="button" onClick={() => void query.refetch()} data-testid="button-retry-public-passport">Try again</button></div>;
  const passport = query.data;
  if (!passport) return null;
  return <PassportCard passport={passport} />;
}

export function MyStreamerPassport() {
  const qc = useQueryClient();
  const query = useGetMyStreamerPassport({ query: { queryKey: getGetMyStreamerPassportQueryKey() } });
  const save = useSaveMyStreamerPassportPlatform();
  const remove = useDeleteMyStreamerPassportPlatform();
  const request = useRequestMyStreamerPassportVerification();
  const [platform, setPlatform] = useState('');
  const [handle, setHandle] = useState('');
  const [editing, setEditing] = useState<MyStreamerPassportPlatform | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const data = query.data;
  const finish = (text: string) => { setNotice({ ok: true, text }); setEditing(null); setPlatform(''); setHandle(''); void qc.invalidateQueries({ queryKey: getGetMyStreamerPassportQueryKey() }); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!platform || !handle.trim()) return;
    setNotice(null);
    save.mutate({ data: { platform: platform as 'liveme' | 'tiktok' | 'bigo' | 'instagram' | 'facebook' | 'youtube' | 'twitch', handleOrUrl: handle.trim() } }, {
      onSuccess: () => finish(editing ? 'Creator profile updated.' : 'Creator profile added.'),
      onError: () => setNotice({ ok: false, text: 'Could not save this profile. Check the handle or URL and try again.' }),
    });
  };
  if (query.isLoading) return <section className="sp-card" aria-label="Streamer passport"><div className="sp-skeleton" role="status" aria-label="Loading your passport"><i /><i /><i /></div></section>;
  if (query.isError || !data) return <section className="sp-card" aria-label="Streamer passport"><ErrorBox error={query.error} retry={() => void query.refetch()} /></section>;
  const entries = data.platforms.map((entry) => ({ ...entry, verified: entry.verificationStatus === 'verified' }));
  const startEdit = (entry: MyStreamerPassportPlatform) => { setEditing(entry); setPlatform(entry.id); setHandle(entry.handle); setNotice(null); };
  const deleteEntry = (entry: MyStreamerPassportPlatform) => {
    if (!window.confirm(`Remove your ${entry.label} profile from your passport?`)) return;
    setNotice(null);
    remove.mutate({ entryId: entry.entryId }, { onSuccess: () => finish(`${entry.label} profile removed.`), onError: () => setNotice({ ok: false, text: 'Could not remove this profile. Try again.' }) });
  };
  const requestCheck = (entry: MyStreamerPassportPlatform) => {
    setNotice(null);
    request.mutate({ entryId: entry.entryId }, { onSuccess: () => finish(`${entry.label} ownership check requested.`), onError: () => setNotice({ ok: false, text: 'Could not request a check. Try again.' }) });
  };
  return <section className="sp-card sp-own" aria-label="Your streamer passport" data-testid="card-my-passport">
    {data.foundingLeague && <FoundingStamp />}
    <PassportIntro title="Streamer passport" detail="Your public creator profiles, all in one place. Add only profiles you own or represent." />
    <div className="sp-private-note" data-testid="notice-passport-private">Your bio code is private to you and moderators. Add it to the profile bio, then request a manual check.</div>
    {entries.length ? <PlatformStamps entries={entries} owner /> : <div className="sp-empty" data-testid="empty-my-passport">Your passport is clear. Add a creator profile below to get started.</div>}
    {entries.map((entry) => {
      const full = data.platforms.find((p) => p.entryId === entry.entryId)!;
      return <div className="sp-manage-row" key={`manage-${entry.entryId}`}>
        <button type="button" className="sp-text-action" onClick={() => startEdit(full)} aria-label={`Edit ${entry.label} profile`} data-testid={`button-edit-platform-${entry.id}`}>Edit</button>
        {entry.verificationStatus === 'requested' && <span className="sp-pending-note">Waiting for moderator review</span>}
        {entry.verificationStatus === 'unverified' && <button type="button" className="sp-text-action sp-request" disabled={request.isPending} onClick={() => requestCheck(full)} data-testid={`button-request-verification-${entry.id}`}>{request.isPending ? 'Requesting…' : 'Request check'}</button>}
        <button type="button" className="sp-text-action sp-remove" disabled={remove.isPending} onClick={() => deleteEntry(full)} aria-label={`Remove ${entry.label} profile`} data-testid={`button-remove-platform-${entry.id}`}><Trash2 size={14} /> Remove</button>
      </div>;
    })}
    <form className="sp-form" onSubmit={submit}>
      <h3>{editing ? `Edit ${editing.label}` : 'Add a platform'}</h3>
      <label className="sp-field"><span>Platform</span>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} required data-testid="select-passport-platform" aria-label="Choose a platform">
          <option value="" disabled>Select platform</option>{data.availablePlatforms.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label className="sp-field"><span>Handle or profile URL</span>
        <input value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={300} required placeholder="Your public profile" autoComplete="url" data-testid="input-passport-handle" aria-label="Handle or profile URL" />
      </label>
      <div className="sp-form-actions">
        <button type="submit" className="sp-button sp-button-gold" disabled={save.isPending || !platform || !handle.trim()} data-testid="button-save-passport-platform">{save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add to passport'}</button>
        {editing && <button type="button" className="sp-button" onClick={() => { setEditing(null); setPlatform(''); setHandle(''); }} data-testid="button-cancel-edit-passport">Cancel</button>}
      </div>
    </form>
    {notice && <p className={`sp-notice${notice.ok ? ' is-ok' : ' is-error'}`} role={notice.ok ? 'status' : 'alert'} data-testid="status-passport-feedback">{notice.text}</p>}
    <footer className="sp-footnote"><ShieldCheck size={15} aria-hidden="true" /> Manual bio-code review only. Deux Wild does not sign in to or verify accounts with platforms.</footer>
  </section>;
}

export function StreamerPassportReview() {
  const qc = useQueryClient();
  const queue = useGetStreamerPassportReviewQueue({ query: { queryKey: getGetStreamerPassportReviewQueueQueryKey() } });
  const review = useReviewStreamerPassportRequest();
  const founding = useSetStreamerPassportFoundingLeague();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [leagueUsername, setLeagueUsername] = useState('');
  if (queue.isLoading) return <section className="sp-review"><PassportIntro title="Passport review" detail="Moderator desk / manual creator ownership checks" /><Loading /></section>;
  if (queue.isError || !queue.data) return <section className="sp-review"><PassportIntro title="Passport review" detail="Moderator desk / manual creator ownership checks" /><ErrorBox error={queue.error} retry={() => void queue.refetch()} /></section>;
  const reviewEntry = (entryId: string, username: string, action: 'approve' | 'reject') => {
    setNotice(null);
    review.mutate({ entryId, data: { action } }, { onSuccess: () => {
      setNotice({ ok: true, text: action === 'approve' ? 'Ownership check approved.' : 'Request rejected.' });
      void qc.invalidateQueries({ queryKey: getGetStreamerPassportReviewQueueQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetSocialPersonStreamerPassportQueryKey(username) });
    }, onError: () => setNotice({ ok: false, text: 'That review could not be saved. Refresh and try again.' }) });
  };
  const setLeague = (username: string, grant: boolean) => {
    setNotice(null);
    founding.mutate({ data: { username, grant } }, { onSuccess: () => {
      setNotice({ ok: true, text: grant ? `Founding League granted to @${username}.` : `Founding League removed from @${username}.` });
      void qc.invalidateQueries({ queryKey: getGetStreamerPassportReviewQueueQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetSocialPersonStreamerPassportQueryKey(username) });
      void qc.invalidateQueries({ queryKey: getGetMyStreamerPassportQueryKey() });
    }, onError: () => setNotice({ ok: false, text: 'Could not update Founding League status. Try again.' }) });
  };
  const submitLeague = (event: FormEvent) => {
    event.preventDefault();
    const username = leagueUsername.trim().replace(/^@/, '');
    if (!username) return;
    setLeague(username, true);
    setLeagueUsername('');
  };
  return <section className="sp-review" data-testid="page-passport-review">
    <PassportIntro title="Passport review" detail="Moderator desk / manual creator ownership checks" />
    <div className="sp-review-callout"><ShieldCheck size={18} /><p>Approve only after checking the exact code in the creator’s public platform bio. This is a community ownership check, never an official platform verification.</p></div>
    {notice && <p className={`sp-notice${notice.ok ? ' is-ok' : ' is-error'}`} role={notice.ok ? 'status' : 'alert'} data-testid="status-review-feedback">{notice.text}</p>}
    <form className="sp-league-lookup" onSubmit={submitLeague}>
      <label htmlFor="sp-league-username">Founding League access</label>
      <div><input id="sp-league-username" value={leagueUsername} onChange={(event) => setLeagueUsername(event.target.value)} placeholder="Username" maxLength={25} data-testid="input-founding-username" />
        <button type="submit" disabled={founding.isPending || !leagueUsername.trim()} data-testid="button-grant-founding-username">{founding.isPending ? 'Saving…' : 'Grant'}</button>
        <button type="button" disabled={founding.isPending || !leagueUsername.trim()} onClick={() => { setLeague(leagueUsername.trim().replace(/^@/, ''), false); setLeagueUsername(''); }} data-testid="button-remove-founding-username">Remove</button>
      </div>
    </form>
    {queue.data.requests.length === 0 ? <div className="sp-empty" data-testid="empty-review-queue">The review queue is clear.</div> : <div className="sp-review-list" data-testid="list-passport-review-requests">
      {queue.data.requests.map((entry) => <article className="sp-review-item" key={entry.entryId} data-testid={`card-review-request-${entry.entryId}`}>
        <div className="sp-review-heading"><Mark label={entry.label} color={entry.color} /><div><strong>{entry.displayName}</strong><span>@{entry.username} · {entry.label} · @{entry.handle}</span></div><time>{niceDate(entry.requestedAt)}</time></div>
        <div className="sp-review-code"><span>Code to locate in public bio</span><code>{entry.verificationCode}</code></div>
        <a className="sp-review-url" href={entry.profileUrl} target="_blank" rel="noopener noreferrer">{entry.profileUrl}<ExternalLink size={14} aria-hidden="true" /></a>
        <div className="sp-review-actions">
          <button type="button" className="sp-button sp-button-gold" disabled={review.isPending} onClick={() => reviewEntry(entry.entryId, entry.username, 'approve')} data-testid={`button-approve-passport-${entry.entryId}`}>{review.isPending ? 'Saving…' : 'Approve check'}</button>
          <button type="button" className="sp-button sp-button-reject" disabled={review.isPending} onClick={() => reviewEntry(entry.entryId, entry.username, 'reject')} data-testid={`button-reject-passport-${entry.entryId}`}>Reject</button>
        </div>
        <div className="sp-league-control"><span>Founding League</span><button type="button" disabled={founding.isPending} onClick={() => setLeague(entry.username, true)} data-testid={`button-grant-founding-${entry.username}`}>Grant</button><button type="button" disabled={founding.isPending} onClick={() => setLeague(entry.username, false)} data-testid={`button-remove-founding-${entry.username}`}>Remove</button></div>
      </article>)}
    </div>}
    <p className="sp-footnote"><Stamp size={15} aria-hidden="true" /> Codes are visible only in this moderator review surface and to their owner.</p>
  </section>;
}

