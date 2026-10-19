import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Coins, Send, RefreshCw, Trash2, Trophy } from 'lucide-react';
import {
  useGetSocialMe, useGetSocialConversation, useSendSocialMessage, useDeleteSocialConversation,
  useClaimSocialDailyReward, useGetSocialLedger, useGetSocialLeaderboard,
  getGetSocialMeQueryKey, getGetSocialConversationQueryKey, getGetSocialLedgerQueryKey,
} from '@workspace/api-client-react';
import { BadgeMark, CoinAmount, Empty, ErrorBox, GiftIcon, Loading, Msg, PersonCard, errMsg, fmt, refreshSocial, useIdemKey } from './common';
import { BadgeArt } from './BadgeArt';
import { ShinyName } from '@/components/ShinyName';

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
      <h1 className="sc-thread-title">
        <Link href="/community/messages" aria-label="Back to My Messages" data-testid="link-my-messages">My Messages</Link>
      </h1>
      <header className="sc-thread-head">
        <Link href={`/community/people/${username}`} className="sc-row"><ShinyName className="sc-name" displayNameColor={d.person.displayNameColor} displayNameTierIndex={d.person.displayNameTierIndex}><BadgeMark id={d.person.badgeId} label={d.person.badgeName} imageUrl={d.person.badgeImage} size={18} compact />{d.person.username}</ShinyName></Link>
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
  const claim = useClaimSocialDailyReward();
  const [msg, setMsg] = useState<{ ok: boolean; t: ReactNode } | null>(null);
  if (me.isLoading) return <Loading />;
  if (me.isError || !me.data) return <ErrorBox error={me.error} retry={() => me.refetch()} />;
  const { wallet: w, products, gifts, inventory } = me.data;
  const doClaim = () => { setMsg(null); claim.mutate(undefined, {
    onSuccess: () => { setMsg({ ok: true, t: <>Claimed <CoinAmount>{w.dailyReward.toLocaleString()} coins</CoinAmount>.</> }); refreshSocial(qc); },
    onError: (e) => setMsg({ ok: false, t: errMsg(e) }) }); };
  return (
    <section>
      {embedded ? <h2 className="bm-h1 sc-h1">Rewards</h2> : <h1 className="bm-h1 sc-h1">Rewards</h1>}
      <p className="bm-lede">Daily reward coins have no cash value. Purchase-tier badges count only completed coin purchases.</p>
      <div className="sc-wallet">
        <div className="sc-balance"><Coins size={28} style={{ color: '#f5cb8d' }} /><b data-testid="text-balance">{w.unlimited ? 'Unlimited test' : w.balance.toLocaleString()}</b><span>coins</span></div>
        <dl>
          <div><dt>Coins earned</dt><dd><CoinAmount>{w.earned.toLocaleString()}</CoinAmount></dd></div>
          <div><dt>Coins received</dt><dd><CoinAmount>{w.received.toLocaleString()}</CoinAmount></dd></div>
          <div><dt>Coins sent</dt><dd><CoinAmount>{w.sent.toLocaleString()}</CoinAmount></dd></div>
        </dl>
        <button type="button" className="bm-btn bm-btn-primary" disabled={!w.canClaimDaily || claim.isPending} onClick={doClaim} data-testid="button-claim">
          {claim.isPending ? 'Claiming...' : w.canClaimDaily ? <>Claim <CoinAmount>{w.dailyReward.toLocaleString()} daily coins</CoinAmount></> : 'Claimed today, back after 00:00 UTC'}</button>
      </div>
      {msg && <Msg ok={msg.ok}>{msg.t}</Msg>}
      <h2 className="sc-h2">Badge store</h2>
      <p className="sc-sub">Your highest qualifying tier is applied automatically. A tier earned in one UTC calendar month stays active through the end of the next month. Gift coins, daily rewards, and old badge purchases do not count.</p>
      <p className="sc-sub" role="note">Coin checkout is currently unavailable, so no new purchase-tier badge can be earned in this preview. Only verified, completed real-money coin purchases will count when checkout is connected.</p>
      <div className="sc-gifts sc-store">{products.map((p) => {
        const earned = me.data.profile.badgeId === p.id;
        return (
        <div key={p.id} className="sc-gift sc-product" data-testid={`card-product-${p.id}`}>
          <BadgeArt id={p.id} name={p.name} imageUrl={p.badgeImage} /><b>{p.name}</b><strong>Monthly purchase threshold</strong>
          <span><CoinAmount>{p.cost.toLocaleString()} coins</CoinAmount> in completed coin purchases during one calendar month</span>
          {earned
            ? <span className="sc-tier-active" data-testid={`status-${p.id}`}>Your highest active tier</span>
            : <span>Not currently active</span>}
          </div>); })}</div>
      <h2 className="sc-h2">Gifts</h2>
      <p className="sc-sub">Send these from anyone's profile.</p>
      <div className="sc-gifts">{gifts.map((g) => <div key={g.id} className="sc-gift"><GiftIcon id={g.id} size={26} /><b>{g.name}</b><CoinAmount>{g.cost.toLocaleString()} coins</CoinAmount></div>)}</div>
       <h2 className="sc-h2">Gift bag</h2>
       {inventory.length === 0 ? <p className="sc-sub">No gifts in your bag yet.</p> : <p className="sc-tags">{inventory.map((id) => <i key={id}>{gifts.find((g) => g.id === id)?.name ?? id}</i>)}</p>}
    </section>
  );
}

const transactionKindLabel: Record<string, string> = {
  credit_purchase: 'Coins purchased',
  gift_sent: 'Gift sent',
  gift_received: 'Gift received',
  reward: 'Coin reward',
  purchase: 'Purchase',
};

function transactionLabel(kind: string) {
  return transactionKindLabel[kind]
    ?? kind.split('_').filter(Boolean).map((word) => word[0]?.toUpperCase() + word.slice(1)).join(' ');
}

function transactionDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function TransactionHistoryPage() {
  const transactions = useGetSocialLedger({
    query: {
      queryKey: getGetSocialLedgerQueryKey(),
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: 'always',
    },
  });

  return (
    <section className="sc-transaction-page" data-testid="page-transaction-history">
      <Link href="/user-portal" className="bm-back" data-testid="link-transaction-history-back">
        <ArrowLeft size={17} aria-hidden="true" /> Back to Me
      </Link>
      <h1 className="bm-h1 sc-h1">Transaction History</h1>
      <p className="sc-sub">Your 100 most recent recorded coin transactions.</p>
      {transactions.isLoading && <Loading />}
      {transactions.isError && <ErrorBox error={transactions.error} retry={() => transactions.refetch()} />}
      {transactions.data && (transactions.data.transactions.length === 0
        ? <p className="sc-transaction-empty" data-testid="state-transactions-empty">No transactions yet.</p>
        : <ul className="sc-transaction-list" data-testid="list-transaction-history">
          {transactions.data.transactions.map((transaction) => {
            const amount = Math.abs(transaction.delta);
            const amountClass = transaction.delta > 0 ? 'sc-plus' : transaction.delta < 0 ? 'sc-minus' : 'sc-transaction-zero';
            const sign = transaction.delta > 0 ? '+' : transaction.delta < 0 ? '−' : '';
            return (
              <li key={transaction.id} className="sc-transaction" data-testid={`transaction-${transaction.kind}`}>
                <div className="sc-transaction-copy">
                  <b className="sc-transaction-kind">{transactionLabel(transaction.kind)}</b>
                  <span className="sc-transaction-description">{transaction.description}</span>
                  {transaction.peer && <small className="sc-transaction-peer">With {transaction.peer}</small>}
                  <time className="sc-transaction-date" dateTime={transaction.createdAt}>{transactionDate(transaction.createdAt)}</time>
                </div>
                <b className={`sc-transaction-amount ${amountClass}`}>
                  <CoinAmount>{sign}{amount.toLocaleString()} coins</CoinAmount>
                </b>
              </li>
            );
          })}
        </ul>)}
    </section>
  );
}

export function LeaderboardPage() {
  const q = useGetSocialLeaderboard({ query: { queryKey: ['/api/social/leaderboard'], refetchInterval: 15000 } });
  return (
    <section>
      <h1 className="bm-h1 sc-h1"><Trophy size={36} /> Leaderboard</h1>
      <p className="bm-lede">Ranked by coins received in gifts.</p>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.data && (q.data.people.length === 0 ? <Empty title="No ranking yet"><p>Gifts sent to opted-in people will show up here.</p></Empty> : (
        <ol className="sc-rank">{q.data.people.map((p, i) => (
          <li key={p.username}>
            <span className="sc-pos" aria-label={`Rank ${i + 1}`}>{i + 1}</span>
            <PersonCard p={p} className="sc-card-leaderboard" showBadgeInName={false}
              extra={<span className="sc-rank-score">
                <BadgeMark id={p.badgeId} label={p.badgeName} imageUrl={p.badgeImage} size={17} compact />
                <b className="sc-score"><CoinAmount>{p.receivedCredits.toLocaleString()}</CoinAmount></b>
              </span>} />
          </li>))}</ol>))}
    </section>
  );
}
