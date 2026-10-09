import '@/beam/beam.css';
import '@/social/social.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetChatAccessQueryKey, getGetMyProfileQueryKey, useConfirmChatAdult, useGetChatAccess, useGetChatDirectory,
  useGetChatReports, useGetMyProfile, useGetSocialMe, useReviewChatReport, useSaveMyProfile,
  getGetChatReportsQueryKey, getGetChatDirectoryQueryKey, ChatReportReviewInputAction,
} from '@workspace/api-client-react';
import { UserPhoto } from '@/components/user-photo';
import { AppLogo } from '@/components/brand';
import { errMessage } from '@/lib/errors';
import { PhotoReviewQueue } from './PhotoReviewQueue';
import { BotModerationPanel } from './BotModerationPanel';
import './chat.css';

const DISCLAIMER = 'Streamtalk is independent and is not affiliated with, endorsed by, or sponsored by any platform named here.';

function Shell({ children }: { children: ReactNode }) {
  return <div className="ch"><div className="ch-in">{children}</div></div>;
}

function Cover({ roomId, i }: { roomId: string; i: number }) {
  const [bad, setBad] = useState(false);
  return (
    <div className={`st-cover st-cover-${i % 6}`}>
      {!bad && <img src={`${import.meta.env.BASE_URL}university-covers/${encodeURIComponent(roomId)}.webp`} alt="" loading="lazy" onError={() => setBad(true)} />}
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
      {q.data && q.data.length > 0 && rows.length === 0 && <p>No university matches your search.</p>}
      <ul className="ch-list st-grid">
        {rows.map((r) => <UniCard key={r.roomId} roomId={r.roomId} label={r.label} headcount={r.headcount} i={(q.data ?? []).findIndex((entry) => entry.roomId === r.roomId)} preview={preview} />)}
      </ul>
    </>
  );
}

function CreditsChip() {
  const me = useGetSocialMe();
  if (!me.data) return null;
  return <Link href="/community/rewards" className="st-credits" data-testid="text-credits">{me.data.wallet.balance.toLocaleString()} credits</Link>;
}

function TopBar({ signedIn, query, setQuery }: { signedIn: boolean; query: string; setQuery: (v: string) => void }) {
  return (
    <div className="st-topbar">
      <Link href={signedIn ? '/home' : '/'} className="st-brand" aria-label="Streamtalk home"><AppLogo size={36} /></Link>
      <input type="search" className="st-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search universities" />
      {signedIn ? <CreditsChip /> : <Link href="/sign-in" className="bm-btn bm-btn-sm bm-btn-primary">Sign in</Link>}
    </div>
  );
}

export function PublicChatLanding() {
  const [query, setQuery] = useState('');
  return (
    <Shell>
      <TopBar signedIn={false} query={query} setQuery={setQuery} />
      <h1>Streamtalk</h1>
      <p>Text chat universities. One account works in any university. Universities are listed by platform label.</p>
      <List preview query={query} />
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
  if (q.data.suspended) return <Shell><h1>Chat access restricted</h1><p>Your access requires review by a Streamtalk moderator. A new age confirmation cannot remove this restriction.</p><Link href="/" className="bm-btn">Home</Link></Shell>;
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
  const [query, setQuery] = useState('');
  return (
    <Shell>
      <TopBar signedIn query={query} setQuery={setQuery} />
      <div className="ch-top">
        <span />
        <span><button type="button" className="bm-btn bm-btn-sm" onClick={() => signOut({ redirectUrl: import.meta.env.BASE_URL || '/' })}>Sign out</button></span>
      </div>
      <h1 aria-label="Streamtalk directory" style={{ color: '#A6FF00', fontWeight: 800, fontFamily: "'Montserrat', sans-serif" }}>STREAMTALK</h1>
      <List query={query} />
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
      {!setup && <div className="ch-top"><Link href="/user-portal" className="bm-btn bm-btn-sm">Back to profile</Link><Link href="/home" className="bm-btn bm-btn-sm">Directory</Link><Link href="/community/profile" className="bm-btn bm-btn-sm">Platform and bio</Link><Link href="/community" className="bm-btn bm-btn-sm">Community</Link></div>}
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
                  <span role="status">{(() => {
                    const status = profile?.photoReviews?.find(p => p.photoUrl === url)?.status ?? 'pending';
                    return status === 'approved' ? 'Approved' : status === 'pending' ? 'Pending review' : 'Not approved — upload another photo';
                  })()}</span>
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
            <p className="ch-note">Add up to 4 photos and choose one main photo. Only approved photos are visible to others. No sexual or explicit photos; keep your profile professional. JPEG, PNG or WebP, up to 5 MiB each. Save changes to apply.{photoUrls.length >= 4 ? ' At the limit: replace or remove a photo to change your collection.' : ''}</p>
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

export { TextChatRoom } from './UniversityRoom';

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
      <PhotoReviewQueue />
      <BotModerationPanel />
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
