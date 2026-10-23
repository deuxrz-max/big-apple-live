import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Gift, MessageCircle, Search } from 'lucide-react';
import {
  useGetSocialMe, useGetSocialPeople, useGetSocialPerson, useSetSocialRelationship, useGetSocialBlocks,
  useSaveSocialProfile, SocialProfileInputExternalPlatform, useSendSocialGift, getGetSocialPeopleQueryKey, getGetSocialPersonQueryKey,
  useUpdateMyEntranceEffectSettings,
  type GetSocialPeopleParams,
  useGetFavoritesGallery, getGetFavoritesGalleryQueryKey, getFavoriteRoom,
} from '@workspace/api-client-react';
import { Avatar, BadgeMark, CoinAmount, Empty, ErrorBox, GiftIcon, Loading, Msg, PersonCard, errMsg, refreshSocial, useIdemKey } from './common';
import { ProfileView, ProfileMenu } from '@/profile/ProfileView';
import { FavoritesGallery, type FavoriteEntry } from './FavoritesGallery';
import { PublicStreamerPassport } from '@/passport/StreamerPassport';
import { isGiftLocked, PLATINUM_UNLOCK_LEVEL } from '@/gifting/gifting';
import '@/gifting/gifting-shield.css';
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
  const send = () => {
    const g = me.data?.gifts.find((x) => x.id === giftId);
    if (!g) return;
    setMsg(null);
    gift.mutate({ data: { recipient: username, giftId, idempotencyKey: idem.get(`${username}:${giftId}`) } }, {
      onSuccess: () => { idem.clear(); setGiftId(''); setMsg({ ok: true, t: <>Sent {g.name} for <CoinAmount>{g.cost.toLocaleString()} coins</CoinAmount>.</> }); refreshSocial(qc); },
      onError: (e) => setMsg({ ok: false, t: errMsg(e) }),
    });
  };
  if (q.isLoading) return <Loading />;
  if (q.isError || !p) return <ErrorBox error={q.error ?? 'Not found'} retry={() => q.refetch()} />;
  const countryName = p.country ? (me.data?.countries.find((c) => c.code === p.country)?.name ?? p.country) : undefined;
  return (
    <ProfileView person={p} own={own} countryName={countryName} products={me.data?.products} backHref="/community"
      menu={own ? null : <ProfileMenu name={p.displayName || p.username} username={p.username} blocked={p.blocked} pending={rel.isPending} onBlock={(a) => setRel('block', a)} />}
      actions={own ? null : (
        <div className="pf-actions">
          <button type="button" className="pf-btn pf-btn-fill" aria-pressed={p.favorite} disabled={rel.isPending || p.blocked} onClick={() => setRel('favorite', !p.favorite)} data-testid="button-favorite">{p.favorite ? 'Following' : 'Follow'}</button>
          {p.blocked
            ? <Link href={`/community/messages/${p.username}`} className="pf-btn" data-testid="link-history">Read history</Link>
            : <Link href={`/community/messages/${p.username}`} className="pf-btn" data-testid="link-message"><MessageCircle size={16} aria-hidden /> Message</Link>}
        </div>
      )}>
      {msg && <Msg ok={msg.ok}>{msg.t}</Msg>}
      {!own && (p.blocked ? <p className="sc-sub">Blocked in either direction: no new gifts, messages or follows. Past messages stay readable.</p> : (
        <div className="sc-panel">
          <h2>Send a gift</h2>
          <p className="sc-sub">Coins have no cash value. Balance: <CoinAmount>{me.data?.wallet.unlimited ? 'Unlimited test coins' : `${me.data?.wallet.balance.toLocaleString() ?? '...'} coins`}</CoinAmount></p>
          <div className="sc-gifts" role="radiogroup" aria-label="Gift">
            {me.data?.gifts.map((g) => (
              <button key={g.id} type="button" role="radio" aria-checked={giftId === g.id} className={`sc-gift${giftId === g.id ? ' is-on' : ''}`}
                disabled={gift.isPending || isGiftLocked(g, me.data?.gifterAccessLevel ?? 0) || (!me.data?.wallet.unlimited && (me.data?.wallet.balance ?? 0) < g.cost)} onClick={() => setGiftId(g.id)} data-testid={`button-gift-${g.id}`}>
                <GiftIcon id={g.id} size={26} /><b>{g.name}</b><CoinAmount>{g.cost.toLocaleString()} coins</CoinAmount>
                {isGiftLocked(g, me.data?.gifterAccessLevel ?? 0) && <span className="gifting-lock-tag" data-testid={`lock-gift-${g.id}`}>Platinum · Lv {PLATINUM_UNLOCK_LEVEL}</span>}</button>
            ))}
          </div>
          <button type="button" className="bm-btn bm-btn-primary" disabled={!giftId || gift.isPending} onClick={send} data-testid="button-send-gift">
            <Gift size={16} /> {gift.isPending ? 'Sending...' : 'Send gift'}</button>
        </div>
      ))}
      <PublicStreamerPassport username={username} />
    </ProfileView>
  );
}

export function MyProfilePage() {
  const qc = useQueryClient();
  const me = useGetSocialMe();
  const save = useSaveSocialProfile();
  const saveEntranceSettings = useUpdateMyEntranceEffectSettings();
  const init = useRef(false);
  const [bio, setBio] = useState('');
  const [country, setCountry] = useState('');
  const [interests, setInterests] = useState('');
  const [discoverable, setDiscoverable] = useState(false);
  const [platform, setPlatform] = useState('');
  const [handle, setHandle] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [entranceMsg, setEntranceMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => {
    const p = me.data?.profile;
    if (p && !init.current) {
      init.current = true;
      setBio(p.bio); setCountry(p.country ?? ''); setInterests(p.interests.join(', ')); setDiscoverable(p.discoverable); setPlatform(p.externalPlatform ?? ''); setHandle(p.externalHandle ?? '');
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
    save.mutate({ data: { bio: bio.trim(), country: country || null, interests: list, discoverable, badgeId: null, externalPlatform: (platform || null) as SocialProfileInputExternalPlatform, externalHandle: platform && handle.trim() ? handle.trim() : null } }, {
      onSuccess: () => { setMsg({ ok: true, t: 'Profile saved.' }); refreshSocial(qc); },
      onError: (er) => setMsg({ ok: false, t: errMsg(er) }),
    });
  };
  const updateEntranceSettings = (data: Parameters<typeof saveEntranceSettings.mutate>[0]["data"]) => {
    setEntranceMsg(null);
    saveEntranceSettings.mutate({ data }, {
      onSuccess: () => {
        setEntranceMsg({ ok: true, t: 'Entrance effect settings saved.' });
        refreshSocial(qc);
        void qc.invalidateQueries();
      },
      onError: (er) => setEntranceMsg({ ok: false, t: errMsg(er) }),
    });
  };
  return (
    <section>
      <h1 className="bm-h1 sc-h1">My profile</h1>
      <p className="sc-sub" data-testid="room-hangout-streak">
        Room hangout streak: <b>Day {d.hangoutStreak.days}/7</b>
        {d.hangoutStreak.rewardClaimedToday
          ? ' · Your 100-coin streak reward was earned today.'
          : ' · Spend at least a minute in a room each hangout day.'}
      </p>
      <div className="sc-hero"><Avatar p={d.profile} size={110} /><div><ShinyName className="sc-name" displayNameColor={d.profile.displayNameColor} displayNameTierIndex={d.profile.displayNameTierIndex}><BadgeMark id={d.profile.badgeId} label={d.profile.badgeName} imageUrl={d.profile.badgeImage} size={18} compact />{d.profile.username}</ShinyName>
        <p className="sc-sub">Change your display name, photo and bio in <Link href="/user-portal/edit" className="bm-link">Edit profile</Link>.</p></div></div>
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
        <p className="sc-sub">Monthly purchase badges are applied automatically when a confirmed coin purchase qualifies. They cannot be selected manually.</p>
        <label className="sc-check"><input type="checkbox" checked={discoverable} onChange={(e) => setDiscoverable(e.target.checked)} data-testid="checkbox-discoverable" />
          <span>Show me in People discovery. Off by default; only you decide.</span></label>
        {msg && <Msg ok={msg.ok}>{msg.t}</Msg>}
        <button type="submit" className="bm-btn bm-btn-primary" disabled={save.isPending} data-testid="button-save-profile">{save.isPending ? 'Saving...' : 'Save profile'}</button>
      </form>
      <section className="sc-panel sc-entrance-settings" aria-labelledby="entrance-effects-title">
        <h2 id="entrance-effects-title" className="sc-h2">Entrance effects</h2>
        {d.entranceEffects.ownerTest ? (
          <>
            <p className="sc-sub">Preview-only owner controls. Equip a tier or Lion badge under My Badges on the profile photo page; only the equipped badge's effect can play.</p>
            <label className="sc-check sc-entrance-master">
              <input type="checkbox" checked={d.entranceEffects.enabled} disabled={saveEntranceSettings.isPending}
                onChange={(e) => updateEntranceSettings({ enabled: e.target.checked })} data-testid="toggle-entrance-effects" />
              <span><b>Enable entrance effects</b><small>Turn this off to keep the badge but silence all entrance effects.</small></span>
            </label>
            <div className="sc-entrance-list" aria-label="Owner entrance effect tests">
              <label className="sc-check sc-entrance-option">
                <input type="checkbox" checked={d.entranceEffects.ownerTest.lionEffectEnabled} disabled={saveEntranceSettings.isPending}
                  onChange={(e) => updateEntranceSettings({ lionEffectEnabled: e.target.checked })} data-testid="toggle-lion-entrance-effect" />
                <span><b>Lion entrance</b><small>Plays only while the Lion badge is equipped.</small></span>
              </label>
              {d.entranceEffects.ownerTest.tiers.map((tier) => (
                <label className="sc-check sc-entrance-option" key={tier.badgeId}>
                  <input type="checkbox" checked={tier.enabled} disabled={saveEntranceSettings.isPending}
                    onChange={(e) => updateEntranceSettings({ tierEffectId: tier.badgeId, tierEffectEnabled: e.target.checked })}
                    data-testid={`toggle-effect-${tier.badgeId}`} />
                  <span><b>{tier.name}</b><small>{tier.enabled ? 'Plays when this badge is equipped.' : 'Off.'}</small></span>
                </label>
              ))}
            </div>
          </>
        ) : d.entranceEffects.eligible ? (
          <>
            <p className="sc-sub">Your equipped badge: <b>{d.entranceEffects.badgeName ?? 'none'}</b>. Choose a badge under My Badges on the profile photo page.</p>
            <label className="sc-check sc-entrance-master">
              <input type="checkbox" checked={d.entranceEffects.enabled} disabled={saveEntranceSettings.isPending}
                onChange={(e) => updateEntranceSettings({ enabled: e.target.checked })} data-testid="toggle-entrance-effects" />
              <span><b>Play my entrance effect</b><small>Your badge stays visible beside your name when this is off.</small></span>
            </label>
          </>
        ) : (
          <p className="sc-sub">An active tier badge is needed before an entrance effect can be turned on or off.</p>
        )}
        {entranceMsg && <Msg ok={entranceMsg.ok}>{entranceMsg.t}</Msg>}
      </section>
    </section>
  );
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
  const present = q.data?.filter(entry => entry.room !== null && !entry.person.blocked);
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
        ? <p className="fg-empty">No one you follow is in a room right now. Check back soon.</p>
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
