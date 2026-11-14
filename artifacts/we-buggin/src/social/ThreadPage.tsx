import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Send, RefreshCw, Trash2 } from 'lucide-react';
import {
  useGetSocialMe, useGetSocialConversation, useSendSocialMessage, useDeleteSocialConversation,
  getGetSocialConversationQueryKey,
} from '@workspace/api-client-react';
import { ErrorBox, Loading, Msg, errMsg, fmt, refreshSocial, useIdemKey } from './common';
import { ShinyName } from '@/components/ShinyName';
import { ActionMenu, ScreenHeader } from '@/components/app-chrome';

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
      onError: er => setMsg({ ok: false, t: errMsg(er) + ' You can retry; the same message will not be sent twice.' }),
    });
  };
  const clear = () => del.mutate({ username }, {
    onSuccess: () => { setConfirmDel(false); refreshSocial(qc); nav('/community/messages'); },
    onError: er => setMsg({ ok: false, t: errMsg(er) }),
  });
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const mine = me.data?.profile.username;
  return (
    <section className="sc-thread">
      <ScreenHeader className="sc-thread-bar" backHref="/community/messages" backLabel="Back to My Messages" testId="header-thread"
        title={<Link href={`/community/people/${username}`} className="sc-thread-person" data-testid="link-thread-person"><ShinyName className="sc-name" displayNameColor={d.person.displayNameColor} displayNameTierIndex={d.person.displayNameTierIndex}>{d.person.username}</ShinyName></Link>}
        subtitle={q.isFetching ? 'Updating' : d.blocked ? 'Read only' : 'Direct message'}
        actions={<ActionMenu label="Conversation actions" testId="menu-thread-actions">
          <button type="button" role="menuitem" onClick={() => q.refetch()} disabled={q.isFetching} data-testid="button-refresh"><RefreshCw size={16} /> Refresh</button>
          <Link href={`/community/people/${username}`} role="menuitem" data-testid="link-thread-profile">View profile</Link>
          <Link href="/community/messages" role="menuitem" data-testid="link-my-messages">My Messages</Link>
          <button type="button" role="menuitem" className="is-danger" onClick={() => setConfirmDel(true)} data-testid="button-clear-history"><Trash2 size={16} /> Clear history</button>
        </ActionMenu>} />
      <header className="sc-thread-head">
        <div className="sc-actions">
          {confirmDel && <span className="sc-confirm">Clear your history with {username}? The other person keeps theirs.
            <button type="button" className="bm-btn bm-btn-sm bm-btn-primary" disabled={del.isPending} onClick={clear} data-testid="button-confirm-clear">Clear for me</button>
            <button type="button" className="bm-btn bm-btn-sm" onClick={() => setConfirmDel(false)} data-testid="button-cancel-clear">Cancel</button></span>}
        </div>
      </header>
      <div className="sc-msgs" aria-live="polite">
        {d.nextCursor && <button type="button" className="bm-btn bm-btn-sm sc-more" onClick={() => setCursor(d.nextCursor ?? undefined)} data-testid="button-older">Load earlier messages</button>}
        {cursor && <button type="button" className="bm-btn bm-btn-sm sc-more" onClick={() => setCursor(undefined)} data-testid="button-latest">Back to latest</button>}
        {d.messages.length === 0 && <p className="sc-sub sc-center">No messages yet.</p>}
        {d.messages.map(m => <div key={m.id} className={`sc-msg${m.sender === mine ? ' is-mine' : ''}`}>
          <p>{m.body}</p><time>{fmt(m.createdAt)}{m.sender === mine && m.readAt ? ' / read' : ''}</time>
        </div>)}
        <div ref={end} />
      </div>
      {d.blocked ? <p className="sc-note is-err">Messaging is off because of a block. History above is read only.</p> : (
        <form className="sc-compose" onSubmit={submit}>
          <label className="sc-sr" htmlFor="sc-body">Message</label>
          <textarea id="sc-body" className="sc-text" rows={1} value={body} maxLength={1000} onChange={e => setBody(e.target.value)} placeholder="Write a message" data-testid="input-message" />
          <button type="submit" className="bm-btn bm-btn-primary" disabled={!t || send.isPending} data-testid="button-send-message"><Send size={18} aria-hidden="true" /><span className="sc-send-label">{send.isPending ? 'Sending' : 'Send'}</span></button>
          <small className="sc-sub">{body.length}/1000</small>
        </form>)}
      {msg && <Msg ok={msg.ok}>{msg.t}</Msg>}
    </section>
  );
}
