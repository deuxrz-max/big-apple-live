import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Heart, Ban, Gift, MessageCircle, Search } from 'lucide-react';
import {
  useGetSocialMe, useGetSocialPeople, useGetSocialPerson, useSetSocialRelationship, useGetSocialBlocks,
  useSaveSocialProfile, SocialProfileInputExternalPlatform, useSendSocialGift, getGetSocialPeopleQueryKey, getGetSocialPersonQueryKey,
  type GetSocialPeopleParams,
} from '@workspace/api-client-react';
import { Avatar, BadgeMark, Empty, ErrorBox, GiftIcon, Loading, Msg, PersonCard, errMsg, refreshSocial, useIdemKey, iconFor } from './common';
import { UserPhoto } from '@/components/user-photo';

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
      <p className="bm-lede">Only people who opted in appear here.</p>
      <form className="sc-filters" onSubmit={submit} role="search">
        <label className="sc-field sc-grow"><span className="bm-label">Search</span>
          <input className="bm-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Username" maxLength={24} data-testid="input-search" /></label>
        <label className="sc-field"><span className="bm-label">Country</span>
          <select className="sc-select" value={country} onChange={(e) => { setCountry(e.target.value); reset(); }} data-testid="select-country">
            <option value="">Anywhere</option>{me.data?.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
        <button type="submit" className="bm-btn bm-btn-primary" data-testid="button-search"><Search size={16} /> Search</button>
      </form>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.data && (list.length === 0 ? (
        <Empty title="Nobody here yet">
          <p>No one matches, or nobody has opted into discovery. Turn yours on in your profile.</p>
          <Link href="/community/profile" className="bm-btn">Edit my profile</Link>
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
  const gift = useSendSocialGift();
  const idem = useIdemKey();
  const [giftId, setGiftId] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  useEffect(() => { setMsg(null); setConfirmBlock(false); }, [username]);
  const p = q.data;
  const own = me.data?.profile.username === username;
  const setRel = (kind: 'favorite' | 'block', active: boolean) => {
    setMsg(null);
    rel.mutate({ username, data: { kind, active } }, {
      onSuccess: () => { setConfirmBlock(false); setMsg({ ok: true, t: kind === 'block' ? (active ? 'Blocked.' : 'Unblocked.') : (active ? 'Added to favorites.' : 'Removed from favorites.') }); refreshSocial(qc); },
      onError: (e) => setMsg({ ok: false, t: errMsg(e) }),
    });
  };
  const send = () => {
    const g = me.data?.gifts.find((x) => x.id === giftId);
    if (!g) return;
    setMsg(null);
    gift.mutate({ data: { recipient: username, giftId, idempotencyKey: idem.get(`${username}:${giftId}`) } }, {
      onSuccess: () => { idem.clear(); setGiftId(''); setMsg({ ok: true, t: `Sent ${g.name} (${g.cost} credits).` }); refreshSocial(qc); },
      onError: (e) => setMsg({ ok: false, t: errMsg(e) }),
    });
  };
  if (q.isLoading) return <Loading />;
  if (q.isError || !p) return <ErrorBox error={q.error ?? 'Not found'} retry={() => q.refetch()} />;
  const badgeName = me.data?.products.find((x) => x.id === p.badgeId)?.name;
  return (
    <section className="sc-profile">
      <Link href="/community" className="bm-back">Back to people</Link>
      <div className="sc-hero">
        <Avatar p={p} size={140} />
        <div>
          <h1 className="bm-h1 sc-h1">{p.username}</h1>
          <p className="sc-sub">@{p.username}{p.country ? ` / ${me.data?.countries.find((c) => c.code === p.country)?.name ?? p.country}` : ''}</p>
          {p.badgeId && <p className="sc-badge-line"><BadgeMark id={p.badgeId} /> {badgeName ?? 'Badge'} <small>Cosmetic only, not verification</small></p>}
          <p className="sc-sub" data-testid="text-received">{p.receivedCredits} credits received in gifts</p>
        </div>
      </div>
      {!!p.photoUrls?.filter(url => url !== p.photoUrl).length && <div className="sc-photos" aria-label="Additional profile photos" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '16px 0' }}>
        {p.photoUrls.filter(url => url !== p.photoUrl).map(url => <UserPhoto key={url} username={p.username} displayName={p.displayName} photoUrl={url} size={96} />)}
      </div>}
      {p.externalPlatform && p.externalHandle && <p className="sc-sub">{p.externalPlatform}: {p.externalHandle} <small>Self-listed, not verified</small></p>}
      {p.bio ? <p className="sc-bio-lg">{p.bio}</p> : <p className="bm-lede">No bio yet.</p>}
      {p.interests.length > 0 && <p className="sc-tags">{p.interests.map((i) => <i key={i}>{i}</i>)}</p>}
      {msg && <Msg ok={msg.ok}>{msg.t}</Msg>}
      {own ? <Link href="/community/profile" className="bm-btn">Edit my profile</Link> : (
        <>
          <div className="sc-actions">
            <button type="button" className="bm-btn" aria-pressed={p.favorite} disabled={rel.isPending || p.blocked} onClick={() => setRel('favorite', !p.favorite)} data-testid="button-favorite">
              <Heart size={16} fill={p.favorite ? 'currentColor' : 'none'} /> {p.favorite ? 'Favorited' : 'Favorite'}</button>
            {p.blocked && <Link href={`/community/messages/${p.username}`} className="bm-btn" data-testid="link-history"><MessageCircle size={16} /> Read history</Link>}
            {!p.blocked && <Link href={`/community/messages/${p.username}`} className="bm-btn" data-testid="link-message"><MessageCircle size={16} /> Message</Link>}
            {p.blocked ? (
              <button type="button" className="bm-btn" disabled={rel.isPending} onClick={() => setRel('block', false)} data-testid="button-unblock"><Ban size={16} /> Unblock</button>
            ) : confirmBlock ? (
              <span className="sc-confirm">Block {p.username}?
                <button type="button" className="bm-btn bm-btn-sm bm-btn-primary" disabled={rel.isPending} onClick={() => setRel('block', true)} data-testid="button-confirm-block">Yes, block</button>
                <button type="button" className="bm-btn bm-btn-sm" onClick={() => setConfirmBlock(false)}>Cancel</button></span>
            ) : (
              <button type="button" className="bm-btn" onClick={() => setConfirmBlock(true)} data-testid="button-block"><Ban size={16} /> Block</button>
            )}
          </div>
          {p.blocked ? <p className="sc-sub">Blocked in either direction: no new gifts, messages or favorites. Past messages stay readable.</p> : (
            <div className="sc-panel">
              <h2>Send a gift</h2>
              <p className="sc-sub">Credits have no cash value. Balance: {me.data?.wallet.balance ?? '...'}</p>
              <div className="sc-gifts" role="radiogroup" aria-label="Gift">
                {me.data?.gifts.map((g) => (
                  <button key={g.id} type="button" role="radio" aria-checked={giftId === g.id} className={`sc-gift${giftId === g.id ? ' is-on' : ''}`}
                    disabled={gift.isPending || (me.data?.wallet.balance ?? 0) < g.cost} onClick={() => setGiftId(g.id)} data-testid={`button-gift-${g.id}`}>
                    <GiftIcon id={g.id} size={26} /><b>{g.name}</b><span>{g.cost} credits</span></button>
                ))}
              </div>
              <button type="button" className="bm-btn bm-btn-primary" disabled={!giftId || gift.isPending} onClick={send} data-testid="button-send-gift">
                <Gift size={16} /> {gift.isPending ? 'Sending...' : 'Send gift'}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function MyProfilePage() {
  const qc = useQueryClient();
  const me = useGetSocialMe();
  const save = useSaveSocialProfile();
  const init = useRef(false);
  const [bio, setBio] = useState('');
  const [country, setCountry] = useState('');
  const [interests, setInterests] = useState('');
  const [discoverable, setDiscoverable] = useState(false);
  const [badgeId, setBadgeId] = useState<string | null>(null);
  const [platform, setPlatform] = useState('');
  const [handle, setHandle] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => {
    const p = me.data?.profile;
    if (p && !init.current) {
      init.current = true;
      setBio(p.bio); setCountry(p.country ?? ''); setInterests(p.interests.join(', ')); setDiscoverable(p.discoverable); setBadgeId(p.badgeId); setPlatform(p.externalPlatform ?? ''); setHandle(p.externalHandle ?? '');
    }
  }, [me.data]);
  if (me.isLoading) return <Loading />;
  if (me.isError || !me.data) return <ErrorBox error={me.error} retry={() => me.refetch()} />;
  const d = me.data;
  const list = interests.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = list.length > 8 || list.some((s) => s.length > 24);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setMsg(null);
    if (bad) { setMsg({ ok: false, t: 'Use up to 8 interests, 24 characters each.' }); return; }
    save.mutate({ data: { bio: bio.trim(), country: country || null, interests: list, discoverable, badgeId, externalPlatform: (platform || null) as SocialProfileInputExternalPlatform, externalHandle: platform && handle.trim() ? handle.trim() : null } }, {
      onSuccess: () => { setMsg({ ok: true, t: 'Profile saved.' }); refreshSocial(qc); },
      onError: (er) => setMsg({ ok: false, t: errMsg(er) }),
    });
  };
  return (
    <section>
      <h1 className="bm-h1 sc-h1">My profile</h1>
      <div className="sc-hero"><Avatar p={d.profile} size={110} /><div><p className="sc-name">{d.profile.username}<BadgeMark id={badgeId} /></p>
        <p className="sc-sub">Change your display name, photo and bio in <Link href="/user-portal" className="bm-link">Edit profile</Link>.</p></div></div>
      <form className="sc-form" onSubmit={submit}>
        <label className="sc-field"><span className="bm-label">Bio ({bio.length}/200)</span>
          <textarea className="sc-text" value={bio} maxLength={200} rows={3} onChange={(e) => setBio(e.target.value)} data-testid="input-bio" /></label>
        <label className="sc-field"><span className="bm-label">Country</span>
          <select className="sc-select" value={country} onChange={(e) => setCountry(e.target.value)} data-testid="select-profile-country">
            <option value="">Prefer not to say</option>{d.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
        <label className="sc-field"><span className="bm-label">Interests, comma separated (max 8)</span>
          <input className="bm-input" value={interests} onChange={(e) => setInterests(e.target.value)} data-testid="input-interests" /></label>
        <label className="sc-field"><span className="bm-label">Other platform (optional, self-listed)</span>
          <select className="sc-select" value={platform} onChange={(e) => setPlatform(e.target.value)} data-testid="select-platform">
            <option value="">None</option>{Object.values(SocialProfileInputExternalPlatform).map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        <label className="sc-field"><span className="bm-label">Handle on that platform</span>
          <input className="bm-input" maxLength={64} value={handle} disabled={!platform} onChange={(e) => setHandle(e.target.value)} data-testid="input-handle" />
          <small>Self-listed. Not ownership checked or officially verified.</small></label>
        <fieldset className="sc-field sc-fs"><legend className="bm-label">Badge (cosmetic, not identity verification)</legend>
          <div className="sc-gifts">
            <button type="button" aria-pressed={badgeId === null} className={`sc-gift${badgeId === null ? ' is-on' : ''}`} onClick={() => setBadgeId(null)}><b>None</b></button>
            {d.inventory.map((id) => { const I = iconFor(id); return (
              <button key={id} type="button" aria-pressed={badgeId === id} className={`sc-gift${badgeId === id ? ' is-on' : ''}`} onClick={() => setBadgeId(id)} data-testid={`button-badge-${id}`}>
                <I size={26} /><b>{d.products.find((p) => p.id === id)?.name ?? id}</b></button>); })}
          </div>
          {d.inventory.length === 0 && <p className="sc-sub">You own no badges. <Link href="/community/rewards" className="bm-link">Visit the store</Link>.</p>}
        </fieldset>
        <label className="sc-check"><input type="checkbox" checked={discoverable} onChange={(e) => setDiscoverable(e.target.checked)} data-testid="checkbox-discoverable" />
          <span>Show me in People discovery. Off by default; only you decide.</span></label>
        {msg && <Msg ok={msg.ok}>{msg.t}</Msg>}
        <button type="submit" className="bm-btn bm-btn-primary" disabled={save.isPending} data-testid="button-save-profile">{save.isPending ? 'Saving...' : 'Save profile'}</button>
      </form>
    </section>
  );
}

export function FavoritesPage() {
  const q = useGetSocialPeople({ favorites: true }, { query: { queryKey: getGetSocialPeopleQueryKey({ favorites: true }), refetchInterval: 15000 } });
  return (
    <section>
      <h1 className="bm-h1 sc-h1">Favorites</h1>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.data && (q.data.people.length === 0
        ? <Empty title="No favorites yet"><p>Favorite someone from their profile to keep them close.</p><Link href="/community" className="bm-btn">Find people</Link></Empty>
        : <div className="sc-grid">{q.data.people.map((p) => <PersonCard key={p.username} p={p} />)}</div>)}
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
      <p className="bm-lede">Blocked people cannot be gifted, messaged or favorited, and they cannot do it to you.</p>
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
