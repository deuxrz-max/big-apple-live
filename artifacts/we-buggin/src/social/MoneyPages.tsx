import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Coins, Send, RefreshCw, Trash2, Trophy } from 'lucide-react';
import {
  useGetSocialMe, useGetSocialConversation, useSendSocialMessage, useDeleteSocialConversation,
  useClaimSocialDailyReward, usePurchaseSocialProduct, useGetSocialLedger, useGetSocialLeaderboard,
  getGetSocialMeQueryKey, getGetSocialConversationQueryKey,
} from '@workspace/api-client-react';
import { BadgeMark, Empty, ErrorBox, GiftIcon, Loading, Msg, PersonCard, errMsg, fmt, iconFor, refreshSocial, useIdemKey } from './common';

export function ThreadPage({ username }: { username: string }) {
  const qc = useQueryClient();
  const [, nav] = useLocation();
  const me = useGetSocialMe();
  const [cursor, setCursor] = useState<string | undefined>();
  const params = cursor ? { cursor } : undefined;
  const q = useGetSocialConversation(username, params, { query: { queryKey: [...getGetSocialConversationQueryKey(username), params ?? {}], refetchInterval: cursor ? false : 3000 } });
  const send = useSendSocialMessage();
  const del = useDeleteSocialConversation();
  const idem = useIdemKey();
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const count = q.data?.messages.length ?? 0;
  useEffect(() => { setCursor(undefined); setMsg(null); setConfirmDel(false); setBody(''); }, [username]);
  useEffect(() => { if (!cursor) end.current?.scrollIntoView({ block: 'end' }); }, [count, cursor]);
  const t = body.trim();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!t || t.length > 1000) return;
    setMsg(null);
    send.mutate({ username, data: { body: t, idempotencyKey: idem.get(`${username}:${t}`) } }, {
      onSuccess: () => { idem.clear(); setBody(''); setCursor(undefined); refreshSocial(qc); },
      onError: (er) => setMsg({ ok: false, t: errMsg(er) + ' You can retry; the same message will not be sent twice.' }),
    });
  };
  const clear = () => del.mutate({ username }, {
    onSuccess: () => { setConfirmDel(false); refreshSocial(qc); nav('/community/messages'); },
    onError: (er) => setMsg({ ok: false, t: errMsg(er) }),
  });
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const mine = me.data?.profile.username;
  return (
    <section className="sc-thread">
      <Link href="/community/messages" className="bm-back">All messages</Link>
      <header className="sc-thread-head">
        <Link href={`/community/people/${username}`} className="sc-row"><span className="sc-name">{d.person.username}<BadgeMark id={d.person.badgeId} /></span></Link>
        <div className="sc-actions">
          <button type="button" className="bm-btn bm-btn-sm" onClick={() => q.refetch()} disabled={q.isFetching} data-testid="button-refresh"><RefreshCw size={14} /> Refresh</button>
          {confirmDel ? (
            <span className="sc-confirm">Clear your history with {username}? The other person keeps theirs.
              <button type="button" className="bm-btn bm-btn-sm bm-btn-primary" disabled={del.isPending} onClick={clear} data-testid="button-confirm-clear">Clear for me</button>
              <button type="button" className="bm-btn bm-btn-sm" onClick={() => setConfirmDel(false)}>Cancel</button></span>
          ) : <button type="button" className="bm-btn bm-btn-sm" onClick={() => setConfirmDel(true)} data-testid="button-clear-history"><Trash2 size={14} /> Clear history</button>}
        </div>
      </header>
      <div className="sc-msgs" aria-live="polite">
        {d.nextCursor && <button type="button" className="bm-btn bm-btn-sm sc-more" onClick={() => setCursor(d.nextCursor ?? undefined)} data-testid="button-older">Load earlier messages</button>}
        {cursor && <button type="button" className="bm-btn bm-btn-sm sc-more" onClick={() => setCursor(undefined)} data-testid="button-latest">Back to latest</button>}
        {d.messages.length === 0 && <p className="sc-sub sc-center">No messages yet.</p>}
        {d.messages.map((m) => (
          <div key={m.id} className={`sc-msg${m.sender === mine ? ' is-mine' : ''}`}>
            <p>{m.body}</p><time>{fmt(m.createdAt)}{m.sender === mine && m.readAt ? ' / read' : ''}</time>
          </div>))}
        <div ref={end} />
      </div>
      {d.blocked ? <p className="sc-note is-err">Messaging is off because of a block. History above is read only.</p> : (
        <form className="sc-compose" onSubmit={submit}>
          <label className="sc-sr" htmlFor="sc-body">Message</label>
          <textarea id="sc-body" className="sc-text" rows={2} value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} placeholder="Write a message" data-testid="input-message" />
          <button type="submit" className="bm-btn bm-btn-primary" disabled={!t || send.isPending} data-testid="button-send-message"><Send size={16} /> {send.isPending ? 'Sending' : 'Send'}</button>
          <small className="sc-sub">{body.length}/1000</small>
        </form>)}
      {msg && <Msg ok={msg.ok}>{msg.t}</Msg>}
    </section>
  );
}

export function RewardsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const me = useGetSocialMe({ query: { queryKey: getGetSocialMeQueryKey(), refetchInterval: 10000 } });
  const ledger = useGetSocialLedger({ query: { queryKey: ['/api/social/wallet/transactions'], refetchInterval: 10000 } });
  const claim = useClaimSocialDailyReward();
  const buy = usePurchaseSocialProduct();
  const idem = useIdemKey();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  if (me.isLoading) return <Loading />;
  if (me.isError || !me.data) return <ErrorBox error={me.error} retry={() => me.refetch()} />;
  const { wallet: w, products, gifts, inventory } = me.data;
  const doClaim = () => { setMsg(null); claim.mutate(undefined, {
    onSuccess: () => { setMsg({ ok: true, t: `Claimed ${w.dailyReward} credits.` }); refreshSocial(qc); },
    onError: (e) => setMsg({ ok: false, t: errMsg(e) }) }); };
  const doBuy = (id: string, name: string) => { setMsg(null); buy.mutate({ data: { itemId: id, idempotencyKey: idem.get(id) } }, {
    onSuccess: () => { idem.clear(); setMsg({ ok: true, t: `${name} is yours.` }); refreshSocial(qc); },
    onError: (e) => setMsg({ ok: false, t: errMsg(e) }) }); };
  return (
    <section>
      {embedded ? <h2 className="bm-h1 sc-h1">Rewards</h2> : <h1 className="bm-h1 sc-h1">Rewards</h1>}
      <p className="bm-lede">Credits are earned, never bought, and have no cash value.</p>
      <div className="sc-wallet">
        <div className="sc-balance"><Coins size={28} /><b data-testid="text-balance">{w.balance}</b><span>credits</span></div>
        <dl><div><dt>Earned</dt><dd>{w.earned}</dd></div><div><dt>Received</dt><dd>{w.received}</dd></div><div><dt>Sent</dt><dd>{w.sent}</dd></div></dl>
        <button type="button" className="bm-btn bm-btn-primary" disabled={!w.canClaimDaily || claim.isPending} onClick={doClaim} data-testid="button-claim">
          {claim.isPending ? 'Claiming...' : w.canClaimDaily ? `Claim ${w.dailyReward} daily credits` : 'Claimed today, back after 00:00 UTC'}</button>
      </div>
      {msg && <Msg ok={msg.ok}>{msg.t}</Msg>}
      <h2 className="sc-h2">Badge store</h2>
      <p className="sc-sub">Badges are permanent and cosmetic. They do not verify who you are. Pick one in <Link href="/community/profile" className="bm-link">your profile</Link>.</p>
      <div className="sc-gifts sc-store">{products.map((p) => { const own = inventory.includes(p.id); const I = iconFor(p.id); return (
        <div key={p.id} className="sc-gift sc-product" data-testid={`card-product-${p.id}`}>
          <I size={30} /><b>{p.name}</b><span>{p.description}</span><span>{p.cost} credits</span>
          <button type="button" className="bm-btn bm-btn-sm" disabled={own || buy.isPending || w.balance < p.cost} onClick={() => doBuy(p.id, p.name)} data-testid={`button-buy-${p.id}`}>
            {own ? 'Owned' : w.balance < p.cost ? 'Not enough credits' : buy.isPending ? 'Buying...' : 'Buy'}</button></div>); })}</div>
      <h2 className="sc-h2">Gifts</h2>
      <p className="sc-sub">Send these from anyone's profile.</p>
      <div className="sc-gifts">{gifts.map((g) => <div key={g.id} className="sc-gift"><GiftIcon id={g.id} size={26} /><b>{g.name}</b><span>{g.cost} credits</span></div>)}</div>
      <h2 className="sc-h2">Inventory</h2>
      {inventory.length === 0 ? <p className="sc-sub">Nothing owned yet.</p> : <p className="sc-tags">{inventory.map((id) => <i key={id}>{products.find((p) => p.id === id)?.name ?? id}</i>)}</p>}
      <h2 className="sc-h2">Ledger</h2>
      {ledger.isLoading && <Loading />}
      {ledger.isError && <ErrorBox error={ledger.error} retry={() => ledger.refetch()} />}
      {ledger.data && (ledger.data.transactions.length === 0 ? <p className="sc-sub">No transactions yet.</p> : (
        <ul className="sc-list">{ledger.data.transactions.map((t) => (
          <li key={t.id} className="sc-ledger"><span><b>{t.description}</b>{t.peer && <small> / {t.peer}</small>}<small className="sc-sub"> {fmt(t.createdAt)}</small></span>
            <b className={t.delta >= 0 ? 'sc-plus' : 'sc-minus'}>{t.delta > 0 ? '+' : ''}{t.delta}</b></li>))}</ul>))}
    </section>
  );
}

export function LeaderboardPage() {
  const q = useGetSocialLeaderboard({ query: { queryKey: ['/api/social/leaderboard'], refetchInterval: 15000 } });
  return (
    <section>
      <h1 className="bm-h1 sc-h1"><Trophy size={36} /> Leaderboard</h1>
      <p className="bm-lede">Ranked by credits received in gifts.</p>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.data && (q.data.people.length === 0 ? <Empty title="No ranking yet"><p>Gifts sent to opted-in people will show up here.</p></Empty> : (
        <ol className="sc-rank">{q.data.people.map((p, i) => (
          <li key={p.username}><span className="sc-pos">{i + 1}</span>
            <PersonCard p={p} extra={<b className="sc-score">{p.receivedCredits}</b>} /></li>))}</ol>))}
    </section>
  );
}
