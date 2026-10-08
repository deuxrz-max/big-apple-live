import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetChatAccessQueryKey, getGetMyProfileQueryKey, useConfirmChatAdult, useGetChatAccess, useGetChatDirectory,
  useGetChatReports, useGetMyProfile, useReportChatMessage, useReviewChatReport, useSaveMyProfile, useSetSocialRelationship,
  getGetChatReportsQueryKey, ChatReportInputReason, ChatReportReviewInputAction, type ChatMessage,
} from '@workspace/api-client-react';
import { UserPhoto } from '@/components/user-photo';
import { errMessage, errStatus } from '@/lib/errors';
import { useTextRoom } from './useTextRoom';
import { RoomAtmosphere } from './RoomAtmosphere';
import { roomVideoMapping } from './video-config';
import './chat.css';

const DISCLAIMER = 'We Buggin is independent and is not affiliated with, endorsed by, or sponsored by any platform named here.';
const FACES = ['\u{1F600}', '\u{1F602}', '\u{1F60D}', '\u{1F62D}', '\u{1F914}', '\u{1F609}', '\u{1F610}', '\u{1F620}'];

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
      <p>Text chat universities. One account works in any university. Universities are listed by platform label.</p>
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
        <span><Link href="/user-portal" className="bm-btn bm-btn-sm">Edit profile</Link> <Link href="/community" className="bm-btn bm-btn-sm">Community</Link>{' '}
          <button type="button" className="bm-btn bm-btn-sm" onClick={() => signOut({ redirectUrl: import.meta.env.BASE_URL || '/' })}>Sign out</button></span>
      </div>
      <h1>Directory</h1>
      <p className="ch-note">Open any university with one account. No seats, no capacity limits.</p>
      <List />
      <p className="ch-note">{DISCLAIMER}</p>
    </Shell>
  );
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

function ProfileGateInner({ children }: { children: ReactNode }) {
  const q = useGetMyProfile();
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
    const data = { username: profile?.username ?? username, displayName: dn, bio: bio.trim(), photoUrl, photoUrls };
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
      {!setup && <div className="ch-top"><Link href="/home" className="bm-btn bm-btn-sm">Directory</Link><Link href="/community/profile" className="bm-btn bm-btn-sm">Platform and bio</Link></div>}
      <h1>{profile ? 'Edit profile' : 'Set up your profile'}</h1>
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
          <label>Display name (shown to others, 1-40 characters)
            <input type="text" value={shownDisplay} maxLength={40} aria-invalid={tried && !dnOk} onChange={(e) => { setNameTouched(true); setDisplayName(e.target.value); }} data-testid="input-display-name" />
            {tried && !dnOk && <span className="ch-fe" role="alert">Enter a display name.</span>}
          </label>
          <label>Bio (optional, up to 280)
            <textarea value={bio} maxLength={280} rows={3} onChange={(e) => setBio(e.target.value)} data-testid="input-bio" />
            <span className="ch-note">{bio.length}/280</span>
          </label>
          <div>
            <p><b>Profile photos (optional, {photoUrls.length}/4)</b></p>
            <div className="ch-photos" aria-label="Saved profile photos">
              {photoUrls.map((url, i) => (
                <div className="ch-photo-card" key={url}>
                  <UserPhoto username={profile?.username ?? username} displayName={dn} photoUrl={url} size={72} />
                  <button type="button" className="bm-btn bm-btn-sm" aria-pressed={photoUrl === url} aria-label={`Use photo ${i + 1} as main photo`} disabled={uploading || save.isPending}
                    onClick={() => { setPhotoUrl(url); setSaved(false); }} data-testid={`button-main-photo-${i}`}>{photoUrl === url ? 'Main' : 'Make main'}</button>
                  <button type="button" className="bm-btn bm-btn-sm" aria-label={`Replace photo ${i + 1}`} disabled={uploading || save.isPending}
                    onClick={() => { replaceTarget.current = url; fileRef.current?.click(); }} data-testid={`button-replace-photo-${i}`}>Replace</button>
                  <button type="button" className="bm-btn bm-btn-sm" aria-label={`Remove photo ${i + 1}`} disabled={uploading || save.isPending}
                    onClick={() => { const remaining = photoUrls.filter(item => item !== url); setPhotoUrls(remaining); if (photoUrl === url) setPhotoUrl(remaining[0] ?? null); setUpErr(null); setSaved(false); }} data-testid={`button-remove-photo-${i}`}>Remove</button>
                </div>
              ))}
            </div>
            {!photoUrls.length && <UserPhoto username={profile?.username ?? username} displayName={dn} photoUrl={null} size={72} />}
            {preview && <div role="status"><UserPhoto displayName={dn} photoUrl={preview} size={72} /> Uploading...</div>}
            <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp" aria-label="Upload profile photo" disabled={uploading || save.isPending} onChange={(e) => pickPhoto(e.target.files?.[0])} data-testid="input-photo" />
            <p><button type="button" className="bm-btn bm-btn-sm ch-add-photo" disabled={photoUrls.length >= 4 || uploading || save.isPending}
              onClick={() => { replaceTarget.current = null; fileRef.current?.click(); }} data-testid="button-add-photo"><span aria-hidden="true">+</span> Click to add</button></p>
            <p className="ch-note">Add up to 4 photos and choose one main photo. All saved photos appear on your profile. JPEG, PNG or WebP, up to 5 MiB each. Save changes to apply.{photoUrls.length >= 4 ? ' At the limit: replace or remove a photo to change your collection.' : ''}</p>
            {upErr && <div className="ch-err" role="alert">{upErr}</div>}
          </div>
          {save.isError && <div className="ch-err" role="alert">{errMessage(save.error)}</div>}
          {saved && <p role="status">Saved.</p>}
          <p><button type="submit" className="bm-btn bm-btn-primary" disabled={save.isPending || uploading} data-testid="button-save-identity">
            {save.isPending ? 'Saving...' : profile ? 'Save changes' : 'Create profile'}</button></p>
        </form>
      )}
      <p className="ch-note">{DISCLAIMER}</p>
    </>
  );
  return <Shell>{body}</Shell>;
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
      <div className="ch-top"><Link href="/home" className="bm-btn bm-btn-sm">Directory</Link><strong>{r.room?.name ?? 'University'}</strong>
        <span className="ch-note" data-testid="status-connection">{r.connection}</span>
        <button type="button" className="bm-btn bm-btn-sm" onClick={() => r.refresh()}>Refresh</button></div>
      {r.error && <div className="ch-err" role="alert">{r.error} <Link href="/user-portal" className="bm-link">Profile</Link></div>}
      <div className="ch-room">
        <div className="ch-atm"><RoomAtmosphere atmosphere={atm} /></div>
        <div className="ch-roster" aria-label="In the university">{people.map((p) => <span key={p.participantId}>{p.displayName}</span>)}</div>
        <div className="ch-msgs" ref={box} role="log" aria-live="polite" aria-label="University messages" tabIndex={0} onScroll={(e) => { const el = e.currentTarget; near.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} data-testid="list-messages">
          {r.hasOlder && <button type="button" className="bm-btn bm-btn-sm" disabled={r.loadingOlder}
            onClick={async () => {
              const el = box.current; const height = el?.scrollHeight ?? 0; const top = el?.scrollTop ?? 0;
              near.current = false; await r.loadOlder();
              requestAnimationFrame(() => { if (el) el.scrollTop = top + el.scrollHeight - height; });
            }}>{r.loadingOlder ? 'Loading older messages…' : 'Load older messages'}</button>}
          {r.loading && <p role="status">Loading history...</p>}
          {!r.loading && msgs.length === 0 && <p className="ch-note">No messages yet.</p>}
          {msgs.map((m) => (
            <div className="ch-msg" key={m.id}>
              <div><Link className="ch-sender" href={`/community/people/${encodeURIComponent(m.username)}`} aria-label={`View ${m.username}'s profile`}>{people.find(p => p.participantId === m.authorId)?.displayName ?? m.username}</Link><p>{m.text}</p>
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
