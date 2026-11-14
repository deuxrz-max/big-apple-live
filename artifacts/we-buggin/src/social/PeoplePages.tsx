import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Search } from 'lucide-react';
import {
  useGetSocialMe, useGetSocialPeople, useGetSocialPerson, useSetSocialRelationship, useGetSocialBlocks,
  getGetSocialPeopleQueryKey, getGetSocialPersonQueryKey,
  type GetSocialPeopleParams,
  useGetFavoritesGallery, getGetFavoritesGalleryQueryKey, getFavoriteRoom,
} from '@workspace/api-client-react';
import { Avatar, Empty, ErrorBox, Loading, Msg, PersonCard, errMsg, refreshSocial } from './common';
import { BackButton, ProfileView, ProfileMenu } from '@/profile/ProfileView';
import { useProfileBackHref } from '@/profile/QuickProfile';
import { FavoritesGallery, type FavoriteEntry } from './FavoritesGallery';
import { ShinyName } from '@/components/ShinyName';

export function CommunityPage() {
  const me = useGetSocialMe();
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [stack, setStack] = useState<number[]>([0]);
  const offset = stack[stack.length - 1];
  const params: GetSocialPeopleParams = { ...(search ? { search } : {}), ...(country ? { country } : {}), ...(offset ? { offset } : {}) };
  const q = useGetSocialPeople(params, { query: { queryKey: getGetSocialPeopleQueryKey(params), refetchInterval: 15000 } });
  const [draft, setDraft] = useState('');
  const reset = () => setStack([0]);
  const submit = (e: FormEvent) => { e.preventDefault(); setSearch(draft.trim()); reset(); };
  const list = q.data?.people ?? [];
  const total = q.data?.total ?? 0;
  const hasNext = offset + list.length < total;
  return (
    <section>
      <h1 className="bm-h1 sc-h1">People</h1>
      <p className="bm-lede">Find people by display name or @ID.</p>
      <form className="sc-filters" onSubmit={submit} role="search">
        <label className="sc-field sc-grow"><span className="bm-label">Search</span>
          <input className="bm-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Display name or @ID" maxLength={80} data-testid="input-search" /></label>
        <label className="sc-field"><span className="bm-label">Country</span>
          <select className="sc-select" value={country} onChange={(e) => { setCountry(e.target.value); reset(); }} data-testid="select-country">
            <option value="">Anywhere</option>{me.data?.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
        <button type="submit" className="bm-btn bm-btn-primary" data-testid="button-search"><Search size={16} /> Search</button>
      </form>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.data && (list.length === 0 ? (
        <Empty title="No one matches that search">
          <p>Try another name, @ID or country.</p>
        </Empty>
      ) : (
        <>
          <p className="sc-count" data-testid="text-total">{total} {total === 1 ? 'person' : 'people'}</p>
          <div className="sc-grid">{list.map((p) => <PersonCard key={p.username} p={p} />)}</div>
          <div className="sc-pager">
            <button type="button" className="bm-btn bm-btn-sm" disabled={stack.length < 2} onClick={() => setStack((s) => s.slice(0, -1))} data-testid="button-prev">Previous</button>
            <button type="button" className="bm-btn bm-btn-sm" disabled={!hasNext} onClick={() => setStack((s) => [...s, offset + list.length])} data-testid="button-next">Next</button>
          </div>
        </>
      ))}
    </section>
  );
}

export function PersonPage({ username }: { username: string }) {
  const qc = useQueryClient();
  const me = useGetSocialMe();
  const q = useGetSocialPerson(username, { query: { queryKey: getGetSocialPersonQueryKey(username), refetchInterval: 15000 } });
  const rel = useSetSocialRelationship();
  const [msg, setMsg] = useState<{ ok: boolean; t: ReactNode } | null>(null);
  useEffect(() => { setMsg(null); }, [username]);
  const p = q.data;
  const own = me.data?.profile.username === username;
  const setRel = (kind: 'favorite' | 'block', active: boolean) => {
    setMsg(null);
    rel.mutate({ username, data: { kind, active } }, {
      onSuccess: () => { setMsg({ ok: true, t: kind === 'block' ? (active ? 'Blocked.' : 'Unblocked.') : (active ? 'Added to favorites.' : 'Removed from favorites.') }); refreshSocial(qc); },
      onError: (e) => setMsg({ ok: false, t: errMsg(e) }),
    });
  };
  const backHref = useProfileBackHref(username, '/community');
  if (q.isLoading) return <><div className="pf-state-back"><BackButton href={backHref} label="Back" /></div><Loading /></>;
  if (q.isError || !p) return <><div className="pf-state-back"><BackButton href={backHref} label="Back" /></div><ErrorBox error={q.error ?? 'Not found'} retry={() => q.refetch()} /></>;
  return (
    <div className="pf-person-wrap">
      <ProfileView person={p} own={own} backHref={backHref}
        menu={own ? null : <ProfileMenu name={p.displayName || p.username} username={p.username} blocked={p.blocked}
          pending={rel.isPending} onBlock={(a) => setRel('block', a)} />}
        actions={own ? null : (
          <div className="pf-actions">
            <button type="button" className="pf-btn pf-btn-fill" aria-pressed={p.favorite} disabled={rel.isPending || p.blocked} onClick={() => setRel('favorite', !p.favorite)} data-testid="button-favorite">{p.favorite ? 'Following' : 'Follow'}</button>
            {p.blocked
              ? <Link href={`/community/messages/${p.username}`} className="pf-btn" data-testid="link-history">Read history</Link>
              : <Link href={`/community/messages/${p.username}`} className="pf-btn" data-testid="link-message"><MessageCircle size={16} aria-hidden /> Message</Link>}
          </div>
        )} />
      {msg && <Msg ok={msg.ok}>{msg.t}</Msg>}
      {!own && p.blocked && <p className="sc-sub">Blocked in either direction: no new messages or follows. Past messages stay readable.</p>}
    </div>
  );
}

export function MyProfilePage() {
  return <Redirect to="/user-portal" />;
}

export function FavoritesPage() {
  const [, navigate] = useLocation();
  const [busyUsername, setBusyUsername] = useState<string | null>(null);
  const busy = useRef(false);
  const [notice, setNotice] = useState('');
  const q = useGetFavoritesGallery({ query: {
    queryKey: getGetFavoritesGalleryQueryKey(), refetchInterval: 15000,
    staleTime: 0, refetchOnWindowFocus: 'always',
  } });
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void q.refetch(); };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [q.refetch]);
  const present = q.data?.filter(entry => !entry.person.blocked);
  async function select(entry: FavoriteEntry) {
    if (busy.current) return;
    if (!entry.room) {
      navigate(`/community/people/${encodeURIComponent(entry.person.username)}`);
      return;
    }
    busy.current = true;
    setBusyUsername(entry.person.username);
    setNotice('');
    try {
      const fresh = await getFavoriteRoom(entry.person.username);
      if (!fresh.room || fresh.room.roomId !== entry.room.roomId) {
        setNotice(!fresh.room ? "They're not in a room anymore." : "They're no longer in that room.");
        await q.refetch();
        return;
      }
      // This route uses the existing profile/access gates and server capacity/overflow checks.
      navigate(`/rooms/${encodeURIComponent(fresh.room.roomId)}`);
    } catch (error) {
      setNotice(errMsg(error));
      void q.refetch();
    } finally {
      busy.current = false;
      setBusyUsername(null);
    }
  }
  return (
    <section className="fg-page">
      <h1 className="fg-title">Following</h1>
      {notice && <p className="sc-note" role="status">{notice}</p>}
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {present && (present.length === 0
        ? <p className="fg-empty">You aren't following anyone yet.</p>
        : <FavoritesGallery entries={present} busyUsername={busyUsername} onSelect={entry => { void select(entry); }} />)}
    </section>
  );
}

export function BlocksPage() {
  const qc = useQueryClient();
  const q = useGetSocialBlocks();
  const rel = useSetSocialRelationship();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const unblock = (username: string) => {
    setBusy(username); setMsg(null);
    rel.mutate({ username, data: { kind: 'block', active: false } }, {
      onSuccess: () => { setMsg({ ok: true, t: `Unblocked ${username}.` }); refreshSocial(qc); },
      onError: (e) => setMsg({ ok: false, t: errMsg(e) }),
      onSettled: () => setBusy(null),
    });
  };
  return (
    <section>
      <h1 className="bm-h1 sc-h1">Blocked</h1>
      <p className="bm-lede">Blocking stops direct messages and whispers both ways and hides each other’s public room chat. It does not remove or mute either person in a room.</p>
      {msg && <Msg ok={msg.ok}>{msg.t}</Msg>}
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.data && (q.data.people.length === 0 ? <Empty title="Nobody blocked" /> : (
        <div className="sc-grid">{q.data.people.map((p) => (
          <PersonCard key={p.username} p={p} extra={<button type="button" className="bm-btn bm-btn-sm" disabled={busy === p.username} onClick={() => unblock(p.username)} data-testid={`button-unblock-${p.username}`}>Unblock</button>} />
        ))}</div>
      ))}
    </section>
  );
}
