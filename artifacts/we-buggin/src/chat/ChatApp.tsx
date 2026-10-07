import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetChatAccessQueryKey, getGetMyProfileQueryKey, useConfirmChatAdult, useGetChatAccess, useGetChatDirectory,
  useGetChatReports, useGetMyProfile, useReportChatMessage, useReviewChatReport, useSaveMyProfile, useSetSocialRelationship,
  getGetChatReportsQueryKey, ChatReportInputReason, ChatReportReviewInputAction, type ChatMessage,
} from '@workspace/api-client-react';
import { IdentityGlyph } from '@/beam/components/IdentityGlyph';
import { beamIdentity } from '@/beam/services/beamService';
import { IdentityEditor } from '@/components/identity-editor';
import { errMessage, errStatus, type Identity } from '@/lib/identity';
import { useTextRoom } from './useTextRoom';
import { RoomAtmosphere } from './RoomAtmosphere';
import { roomVideoMapping } from './video-config';
import './chat.css';

const DISCLAIMER = 'We Buggin is independent and is not affiliated with, endorsed by, or sponsored by any platform named here.';
const FACES = ['\u{1F600}', '\u{1F602}', '\u{1F60D}', '\u{1F62D}', '\u{1F914}', '\u{1F609}', '\u{1F610}', '\u{1F620}'];
const START: Identity = { emojiId: '1F600', gender: 'Female', color: '#F7C531', hairColor: '#E8187F' };
const Face = ({ identity, size = 36 }: { identity: Identity; size?: number }) => <IdentityGlyph identity={beamIdentity(identity)} size={size} />;

function Shell({ children }: { children: ReactNode }) {
  return <div className="ch"><div className="ch-in">{children}</div></div>;
}

function List({ preview }: { preview?: boolean }) {
  const q = useGetChatDirectory();
  return (
    <>
      {q.isLoading && <p role="status">Loading directory...</p>}
      {q.isError && <div className="ch-err" role="alert">{preview ? 'Sign in to see the directory.' : 'Could not load the directory.'} {!preview && <button type="button" className="bm-btn bm-btn-sm" onClick={() => q.refetch()}>Retry</button>}</div>}
      {q.data && q.data.length === 0 && <p>No entries.</p>}
      <ul className="ch-list">
        {q.data?.map((r) => (
          <li key={r.roomId} data-testid={`row-room-${r.roomId}`}>
            <span>{r.label}</span>
            {!preview && <Link href={`/rooms/${encodeURIComponent(r.roomId)}`} className="bm-btn bm-btn-sm">Open</Link>}
          </li>
        ))}
      </ul>
    </>
  );
}

export function PublicChatLanding() {
  return (
    <Shell>
      <h1>We Buggin</h1>
      <p>Text chat rooms. One account works in any room. Rooms are listed by platform label.</p>
      <List preview />
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
  if (q.data.suspended) return <Shell><h1>Chat access restricted</h1><p>Your access requires review by a We Buggin moderator. A new age confirmation cannot remove this restriction.</p><Link href="/" className="bm-btn">Home</Link></Shell>;
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
  return (
    <Shell>
      <div className="ch-top">
        <Link href="/home" className="bm-btn bm-btn-sm">We Buggin</Link>
        <span><Link href="/user-portal" className="bm-btn bm-btn-sm">Profile</Link> <Link href="/community" className="bm-btn bm-btn-sm">Community</Link>{' '}
          <button type="button" className="bm-btn bm-btn-sm" onClick={() => signOut({ redirectUrl: import.meta.env.BASE_URL || '/' })}>Sign out</button></span>
      </div>
      <h1>Directory</h1>
      <p className="ch-note">Open any room with one account. No seats, no capacity limits.</p>
      <List />
      <p className="ch-note">{DISCLAIMER}</p>
    </Shell>
  );
}

export function ChatProfile() {
  const qc = useQueryClient();
  const [, nav] = useLocation();
  const q = useGetMyProfile();
  const save = useSaveMyProfile();
  const profile = q.data?.profile ?? null;
  const [username, setUsername] = useState('');
  const [identity, setIdentity] = useState<Identity>(START);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (profile) setIdentity(profile.identity); }, [profile?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameOk = profile ? true : /^[A-Za-z0-9_]{3,24}$/.test(username);
  return (
    <Shell>
      <div className="ch-top"><Link href="/home" className="bm-btn bm-btn-sm">Directory</Link><Link href="/community/profile" className="bm-btn bm-btn-sm">Platform and bio</Link></div>
      <h1>{profile ? profile.username : 'Your profile'}</h1>
      {q.isLoading && <p role="status">Loading...</p>}
      {q.isError && <div className="ch-err" role="alert">Could not load your account. <button type="button" className="bm-btn bm-btn-sm" onClick={() => q.refetch()}>Retry</button></div>}
      {q.data && (
        <>
          {!profile && <label>Username (permanent, 3-24 letters, digits, underscores)<br /><input type="text" value={username} maxLength={24} onChange={(e) => setUsername(e.target.value)} data-testid="input-username" /></label>}
          <IdentityEditor value={identity} onChange={setIdentity} />
          {save.isError && <div className="ch-err" role="alert">{errStatus(save.error) === 409 ? 'That username is taken, or cannot be changed.' : errMessage(save.error)}</div>}
          {saved && <p role="status">Saved.</p>}
          <p><button type="button" className="bm-btn bm-btn-primary" disabled={!nameOk || save.isPending} data-testid="button-save-identity"
            onClick={() => { setSaved(false); save.mutate({ data: { username: profile?.username ?? username, identity } }, { onSuccess: (p) => { qc.setQueryData(getGetMyProfileQueryKey(), { profile: p }); setSaved(true); if (!profile) nav('/home'); } }); }}>
            {save.isPending ? 'Saving...' : profile ? 'Save changes' : 'Claim name and save'}</button></p>
        </>
      )}
      <p className="ch-note">Financial policy is pending a separate decision; existing community routes are unchanged.</p>
    </Shell>
  );
}

const SCENE: Record<string, string> = { city: 'city', calm: 'calm', volcano: 'volcano' };

export function TextChatRoom({ roomId, userId }: { roomId: string; userId: string }) {
  const qc = useQueryClient();
  const r = useTextRoom(roomId, userId);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ChatMessage | null>(null);
  const [reason, setReason] = useState<string>(ChatReportInputReason.harassment);
  const [details, setDetails] = useState('');
  const report = useReportChatMessage({
    request: { headers: { "X-Room-Session": r.creds?.participantSessionId ?? "" } },
  });
  const block = useSetSocialRelationship();
  const box = useRef<HTMLDivElement>(null);
  const near = useRef(true);
  const msgs = r.messages;
  useEffect(() => { const el = box.current; if (el && near.current) el.scrollTop = el.scrollHeight; }, [msgs.length]);
  const atm = r.room?.communityAtmosphere;
  const people = useMemo(() => r.room?.participants ?? [], [r.room]);
  const doSend = async (t: string, kind: 'text' | 'reaction' = 'text') => {
    const v = t.trim();
    if (!v || v.length > 280) return;
    setPending(true); setSendErr(null);
    try { await r.send(v, kind); if (kind === 'text') setText(''); qc.invalidateQueries({ queryKey: getGetMyProfileQueryKey() }); }
    catch (e) { setSendErr(errStatus(e) === 409 ? 'Create your profile first.' : errMessage(e)); }
    finally { setPending(false); }
  };
  return (
    <div className="ch"><div className="ch-in">
      <div className="ch-top"><Link href="/home" className="bm-btn bm-btn-sm">Directory</Link><strong>{r.room?.name ?? 'Room'}</strong>
        <span className="ch-note" data-testid="status-connection">{r.connection}</span>
        <button type="button" className="bm-btn bm-btn-sm" onClick={() => r.refresh()}>Refresh</button></div>
      {r.error && <div className="ch-err" role="alert">{r.error} <Link href="/user-portal" className="bm-link">Profile</Link></div>}
      <div className="ch-room">
        <div className="ch-atm"><RoomAtmosphere atmosphere={atm} /></div>
        <div className="ch-roster" aria-label="In the room">{people.map((p) => <span key={p.participantId}>{p.identity && <Face identity={p.identity} size={22} />}{p.displayName}</span>)}</div>
        <div className="ch-msgs" ref={box} role="log" aria-live="polite" aria-label="Room messages" tabIndex={0} onScroll={(e) => { const el = e.currentTarget; near.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} data-testid="list-messages">
          {r.hasOlder && <button type="button" className="bm-btn bm-btn-sm" disabled={r.loadingOlder}
            onClick={async () => {
              const el = box.current; const height = el?.scrollHeight ?? 0; const top = el?.scrollTop ?? 0;
              near.current = false; await r.loadOlder();
              requestAnimationFrame(() => { if (el) el.scrollTop = top + el.scrollHeight - height; });
            }}>{r.loadingOlder ? 'Loading older messages…' : 'Load older messages'}</button>}
          {r.loading && <p role="status">Loading history...</p>}
          {!r.loading && msgs.length === 0 && <p className="ch-note">No messages yet.</p>}
          {msgs.map((m) => (
            <div className="ch-msg" key={m.id}><Face identity={people.find(p => p.participantId === m.authorId)?.identity ?? m.identity} />
              <div><b>{m.username}</b><p>{m.text}</p>
                <div className="ch-acts"><button type="button" onClick={() => { setReporting(m); setNote(null); }}>Report</button>
                  <button type="button" disabled={block.isPending} onClick={() => block.mutate({ username: m.username, data: { kind: 'block', active: true } }, { onSuccess: () => { setNote(`Blocked ${m.username}.`); r.refresh(); }, onError: (e) => setNote(errMessage(e)) })}>Block</button></div></div></div>
          ))}
        </div>
        {reporting && (
          <div className="ch-comp" role="dialog" aria-label="Report message">
            <span>Report {reporting.username}</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>{Object.values(ChatReportInputReason).map((x) => <option key={x}>{x}</option>)}</select>
            <input type="text" maxLength={500} placeholder="Details (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
            <button type="button" className="bm-btn bm-btn-sm bm-btn-primary" disabled={report.isPending} onClick={() => report.mutate({ data: { roomId, messageId: reporting.id, reason: reason as ChatReportInputReason, ...(details ? { details } : {}) } }, { onSuccess: (x) => { setNote(`Report queued (${x.status}).`); setReporting(null); setDetails(''); }, onError: (e) => setNote(errMessage(e)) })}>Send report</button>
            <button type="button" className="bm-btn bm-btn-sm" onClick={() => setReporting(null)}>Cancel</button>
          </div>
        )}
        <form className="ch-comp" onSubmit={(e) => { e.preventDefault(); doSend(text); }}>
          <input type="text" value={text} maxLength={280} onChange={(e) => setText(e.target.value)} placeholder="Say something (1-280)" aria-label="Message" data-testid="input-message" />
          <button type="submit" className="bm-btn bm-btn-primary" disabled={pending || !text.trim()} data-testid="button-send">{pending ? 'Sending...' : 'Send'}</button>
          <div className="ch-faces">{FACES.map((f) => <button key={f} type="button" disabled={pending} aria-label={`Send ${f}`} onClick={() => doSend(f, 'reaction')}>{f}</button>)}</div>
        </form>
      </div>
      {sendErr && <div className="ch-err" role="alert">{sendErr}</div>}
      {note && <p role="status">{note} <Link href="/community/blocks" className="bm-link">Blocked list</Link></p>}
      <p className="ch-note">{atm ? `Activity-based scene: ${SCENE[atm.scene]}, ${atm.activity} messages in the last ${Math.round(atm.windowMs / 60000)} minutes. ` : ''}Tone switching is off. {roomVideoMapping[atm?.scene ?? 'calm'].src ? 'Muted video configured; static fallback available.' : 'Backdrop is a static placeholder; final videos have not been supplied.'}</p>
      <p className="ch-note">{DISCLAIMER}</p>
    </div></div>
  );
}

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
