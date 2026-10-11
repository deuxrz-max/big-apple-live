import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetMyProfileQueryKey, getGetUniversitySessionQueryKey, useAcknowledgeUniversityRules, useGetUniversitySession,
  useReportChatMessage, useSendUniversityWhisper, useSetSocialRelationship, useSetUniversityIgnore,
  ChatReportInputReason, type ChatMessage,
  type RoomGiftEvent,
} from '@workspace/api-client-react';
import { UserPhoto } from '@/components/user-photo';
import { errMessage, errStatus } from '@/lib/errors';
import { BadgeMark } from '@/social/common';
import { useTextRoom } from './useTextRoom';
import { PromoBackground } from './PromoBackground';
import { BotShield } from './BotShield';
import { GiftBag, GiftControl } from '@/gifts';
import { useRoomGifts } from '@/gifts/useRoomGifts';
import { HeartAnimation } from '@/gifts/HeartAnimation';
import { CosmicEncoreAnimation, MoonfoxAnimation, SpiritAnimation } from '@/gifts/SpiritPup';
import './university-room.css';
import './bot-moderation.css';

const FACES = ['\u{1F600}', '\u{1F602}', '\u{1F60D}', '\u{1F62D}', '\u{1F914}', '\u{1F609}', '\u{1F610}', '\u{1F620}'];
const RULES = "Stick to the room's topic. Be kind — no harassment or hate. Nothing sexual or explicit, in chat, names or photos. Don't share real names, phone numbers, addresses or other contact details. Don't hog the screen, no ALL CAPS, no ads or spam. Use Ignore on anyone bothering you, or Block and Report for anything serious. Public university chat is moderated by Streamtalk bots. Whispers and direct messages are private and are not scanned by these bots.";

type Target = { username: string; displayName: string; displayNameColor?: string };
type Item = { kind: 'room'; at: number; id: string; m: ChatMessage } | { kind: 'gift'; at: number; id: string; gift: RoomGiftEvent } | { kind: 'whisper'; at: number; id: string; w: { id: string; username: string; displayName: string; displayNameColor?: string; outgoing: boolean; body: string } };

export function TextChatRoom({ roomId, userId }: { roomId: string; userId: string }) {
  const soundScope = `${roomId}:${userId}`;
  const [sound, setSound] = useState({ scope: soundScope, on: false });
  const soundOn = sound.scope === soundScope && sound.on;
  const [backgroundUnavailable, setBackgroundUnavailable] = useState(false);
  const qc = useQueryClient();
  const [, nav] = useLocation();
  const r = useTextRoom(roomId, userId);
  const sessionId = r.creds?.participantSessionId ?? '';
  const sessionKey = [...getGetUniversitySessionQueryKey(roomId), 'user', userId] as const;
  const headers = { 'X-Room-Session': sessionId };
  const uni = useGetUniversitySession(roomId, {
    request: { headers },
    query: { enabled: !!sessionId, refetchInterval: 3000, queryKey: sessionKey },
  });
  const ignoreMut = useSetUniversityIgnore({ request: { headers } });
  const whisperMut = useSendUniversityWhisper({ request: { headers } });
  const ack = useAcknowledgeUniversityRules();
  const report = useReportChatMessage({ request: { headers: { 'X-Room-Session': sessionId } } });
  const block = useSetSocialRelationship();

  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ChatMessage | null>(null);
  const [reason, setReason] = useState<string>(ChatReportInputReason.harassment);
  const [details, setDetails] = useState('');
  const [whisperTo, setWhisperTo] = useState<Target | null>(null);
  const [menu, setMenu] = useState<Target | null>(null);
  const [giftBag, setGiftBag] = useState<{ recipient: Target | null } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const gifts = useRoomGifts(roomId, userId, sessionId, ignored);
  const ignoreBusy = useRef(0);
  const idem = useRef<{ username: string; body: string; key: string } | null>(null);
  const autoRules = useRef(false);
  const ignoreVersion = useRef<string | null>(null);
  const peopleBtn = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const drawerBox = useRef<HTMLElement>(null);
  const menuBox = useRef<HTMLDivElement>(null);
  const rulesBox = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const near = useRef(true);

  const session = uni.data;
  useEffect(() => {
    setSound({ scope: soundScope, on: false });
    setText(''); setWhisperTo(null); setMenu(null); setDrawer(false); setRulesOpen(false);
    setGiftBag(null);
    setIgnored(new Set()); setSendErr(null); setNote(null);
    autoRules.current = false; ignoreVersion.current = null; idem.current = null;
  }, [roomId, userId]);
  useEffect(() => {
    if (session && ignoreBusy.current === 0) {
      setIgnored(new Set(session.ignoredUsernames));
      const version = [...session.ignoredUsernames].sort().join('|');
      if (ignoreVersion.current !== null && ignoreVersion.current !== version) void r.refresh();
      ignoreVersion.current = version;
    }
  }, [session]);
  useEffect(() => {
    if (session && !session.rulesSeen && !autoRules.current) { autoRules.current = true; setRulesOpen(true); }
  }, [session]);
  useEffect(() => {
    if (!drawer && !menu && !rulesOpen) return;
    const dialog = menu ? menuBox.current : rulesOpen ? rulesBox.current : drawerBox.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]') ?? [])]
      .filter(el => el.offsetParent !== null);
    focusable()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const elements = focusable();
        const first = elements[0], last = elements.at(-1);
        if (first && (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          e.preventDefault(); (e.shiftKey ? last : first)?.focus();
        }
      }
      if (e.key !== 'Escape') return;
      if (menu) setMenu(null); else if (rulesOpen) dismissRules(); else closeDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previousFocus?.focus(); };
  }, [drawer, menu, rulesOpen]);
  useEffect(() => { if (drawer) closeBtn.current?.focus(); }, [drawer]);
  const closeDrawer = () => { setDrawer(false); peopleBtn.current?.focus(); };
  function dismissRules() {
    if (ack.isPending) return;
    ack.mutate(undefined, { onSuccess: () => {
      setRulesOpen(false);
      qc.invalidateQueries({ queryKey: getGetUniversitySessionQueryKey(roomId) });
    } });
  }

  const people = session?.people ?? [];
  const giftRecipients = people.filter(person => !person.self && !person.botId)
    .map(({ username, displayName, displayNameColor }) => ({ username, displayName, displayNameColor }));
  const me = people.find((p) => p.self);
  const isSelf = (username: string, authorId?: string) => (!!authorId && authorId === r.creds?.participantId) || me?.username === username;
  const nameOf = (username: string, fallback?: string) => people.find((p) => p.username === username)?.displayName ?? fallback ?? username;
  const nameColorOf = (username: string, fallback?: string) => people.find((p) => p.username === username)?.displayNameColor ?? fallback ?? '#FFFFFF';

  const items = useMemo<Item[]>(() => {
    const a: Item[] = r.messages.filter((m) => m.botId || !ignored.has(m.username)).map((m) => ({ kind: 'room' as const, at: new Date(m.createdAt).getTime(), id: m.id, m }));
    const b: Item[] = (session?.whispers ?? []).filter((w) => !ignored.has(w.username)).map((w) => ({ kind: 'whisper' as const, at: new Date(w.createdAt).getTime(), id: `w-${w.id}`, w }));
    const c: Item[] = gifts.events.map(gift => ({ kind: 'gift', at: new Date(gift.createdAt).getTime(), id: `gift-${gift.id}`, gift }));
    return [...a, ...b, ...c].sort((x, y) => x.at - y.at || x.id.localeCompare(y.id));
  }, [r.messages, session?.whispers, ignored, gifts.events]);
  useEffect(() => { const el = box.current; if (el && near.current) el.scrollTop = el.scrollHeight; }, [items.length]);

  const toggleIgnore = (t: Target) => {
    const next = !ignored.has(t.username);
    ignoreBusy.current++;
    setIgnored((prev) => { const s = new Set(prev); if (next) s.add(t.username); else s.delete(t.username); return s; });
    setMenu(null); setNote(null);
    ignoreMut.mutate({ username: t.username, data: { active: next } }, {
      onSuccess: () => {
        ignoreBusy.current--;
        setNote(next ? `Ignoring ${t.displayName}.` : `Stopped ignoring ${t.displayName}.`);
        qc.invalidateQueries({ queryKey: getGetUniversitySessionQueryKey(roomId) });
        r.refresh();
      },
      onError: (e) => {
        ignoreBusy.current--;
        setIgnored((prev) => { const s = new Set(prev); if (next) s.delete(t.username); else s.add(t.username); return s; });
        setNote(errMessage(e));
      },
    });
  };
  const openMenu = (username: string, displayName: string, authorId?: string, displayNameColor?: string) => {
    if (!isSelf(username, authorId)) setMenu({
      username, displayName,
      displayNameColor: displayNameColor ?? nameColorOf(username),
    });
  };

  const doSend = async (t: string, kind: 'text' | 'reaction' = 'text') => {
    const v = t.trim();
    if (!v || v.length > 280) return;
    setPending(true); setSendErr(null);
    try { await r.send(v, kind); if (kind === 'text') setText(''); qc.invalidateQueries({ queryKey: getGetMyProfileQueryKey() }); }
    catch (e) { setSendErr(errStatus(e) === 409 ? 'Create your profile first.' : errMessage(e)); }
    finally { setPending(false); }
  };
  const doWhisper = () => {
    const body = text.trim();
    if (!whisperTo || !body || body.length > 1000 || !sessionId || whisperMut.isPending) return;
    if (!idem.current || idem.current.username !== whisperTo.username || idem.current.body !== body) {
      idem.current = { username: whisperTo.username, body, key: crypto.randomUUID() };
    }
    setSendErr(null);
    whisperMut.mutate({ roomId, data: { username: whisperTo.username, body, idempotencyKey: idem.current.key } }, {
      onSuccess: () => {
        idem.current = null; setText('');
        qc.invalidateQueries({ queryKey: getGetUniversitySessionQueryKey(roomId) });
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/api/social') });
      },
      onError: (e) => setSendErr(errMessage(e)),
    });
  };
  const whispering = !!whisperTo;
  const limit = whispering ? 1000 : 280;

  const peopleList = (
    <>
      <div className="ur-people-head">
        <h2 id="ur-people-title">People · {people.length}</h2>
        <button type="button" ref={closeBtn} className="bm-btn bm-btn-sm ur-close" onClick={closeDrawer}>Close</button>
      </div>
      {uni.isLoading && <p role="status" className="ch-note">Loading people...</p>}
      {uni.isError && <div className="ch-err" role="alert">Could not load people. <button type="button" className="bm-btn bm-btn-sm" onClick={() => uni.refetch()}>Retry</button></div>}
      {session && people.length === 0 && <p className="ch-note">Nobody else is here yet.</p>}
      <ul className="ur-people">
        {people.map((p) => {
          if (p.botId) return (
            <li key={p.participantId}><div className="ur-prow" data-testid={`row-bot-${p.botId}`}>
              <UserPhoto username={p.username} displayName={p.displayName} photoUrl={p.photoUrl} size={36} />
              <Link href={`/community/bots/${p.botId}`} className="ur-pname ur-bot-name" data-testid={`link-bot-${p.botId}`}><span>{p.displayName}</span><BotShield botId={p.botId} /></Link>
            </div></li>
          );
          const ign = ignored.has(p.username);
          const inner = (
            <>
              <UserPhoto username={p.username} displayName={p.displayName} photoUrl={p.photoUrl} size={36} reviewStatus={p.self && p.photoStatus ? p.photoStatus : undefined} />
              <span className="ur-pname">
                <span className="ur-pname-text" style={{ color: p.displayNameColor ?? '#FFFFFF' }}>{p.displayName}{p.self && <em> (you)</em>}</span>
                <BadgeMark id={p.badgeId ?? null} label={p.badgeId ? `${p.badgeId === 'night-owl' ? 'Night Owl' : p.badgeId.replaceAll('-', ' ')} badge` : undefined} size={16} compact />
              </span>
              {p.moderator && <span className="ur-badge">Moderator</span>}
              {ign && <span className="ur-ign">Ignored</span>}
            </>
          );
          return (
            <li key={p.participantId}>
              {p.self ? <div className="ur-prow">{inner}</div>
                : <button type="button" className="ur-prow" aria-haspopup="menu" onClick={() => setMenu({ username: p.username, displayName: p.displayName, displayNameColor: p.displayNameColor ?? '#FFFFFF' })} data-testid={`button-person-${p.username}`}>{inner}</button>}
            </li>
          );
        })}
      </ul>
    </>
  );

  return (
    <div className="ch ch-university ur">
      <div className="ch-atm"><PromoBackground key={`${roomId}:${userId}`} soundOn={soundOn} onUnavailableChange={setBackgroundUnavailable} /></div>
      <div className="ch-in ur-in">
        <div className="ur-head">
          <button type="button" ref={peopleBtn} className="bm-btn bm-btn-sm ur-people-btn" aria-haspopup="dialog" aria-expanded={drawer} onClick={() => setDrawer(true)} data-testid="button-people">People · {people.length}</button>
          <div className="ur-titlebox">
            <h1 className="ch-title ur-title" aria-label={r.room?.name ?? 'University'} data-testid="text-university-name">
              {(r.room?.name ?? 'University').split(/\s+/).map((w, i) => (
                <span className="ch-word" key={`${w}-${i}`} style={{ animationDelay: `${i * 140}ms` }}>{w}</span>
              ))}
            </h1>
            {session?.topic && <p className="ur-topic" title={session.topic} data-testid="text-topic">{session.topic}</p>}
          </div>
          <button type="button" className="bm-btn bm-btn-sm ur-rules-btn" onClick={() => setRulesOpen(true)} data-testid="button-rules">Rules</button>
        </div>
        {r.error && <div className="ch-err" role="alert">{r.error} <Link href="/user-portal" className="bm-link">Profile</Link></div>}
        {r.overflow && <p><Link className="bm-btn bm-btn-primary" href={`/rooms/${encodeURIComponent(r.overflow.roomId)}`}>Enter {r.overflow.label}</Link></p>}
        <div className="ur-sound-row">
          <GiftControl onClick={() => { setMenu(null); setDrawer(false); setGiftBag({ recipient: null }); }} />
          <button type="button" className="bm-btn bm-btn-sm" aria-pressed={soundOn}
            aria-label={soundOn ? 'Turn background sound off' : 'Turn background sound on'}
            disabled={backgroundUnavailable} data-testid="button-background-sound"
            onClick={() => setSound({ scope: soundScope, on: !soundOn })}>
            {backgroundUnavailable ? 'Sound unavailable' : soundOn ? 'Sound on' : 'Sound off'}
          </button>
        </div>
        <div className="ur-body">
          <aside ref={drawerBox} className={`ur-side${drawer ? ' is-open' : ''}`} role={drawer ? 'dialog' : undefined} aria-modal={drawer ? true : undefined} aria-labelledby="ur-people-title">
            {peopleList}
          </aside>
          {drawer && <div className="ur-backdrop" onClick={closeDrawer} aria-hidden="true" />}
          <div className="ch-room">
            <div className="ch-msgs" ref={box} role="log" aria-live="polite" aria-label="University messages" tabIndex={0} onScroll={(e) => { const el = e.currentTarget; near.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} data-testid="list-messages">
              {r.hasOlder && <button type="button" className="bm-btn bm-btn-sm" disabled={r.loadingOlder}
                onClick={async () => {
                  const el = box.current; const height = el?.scrollHeight ?? 0; const top = el?.scrollTop ?? 0;
                  near.current = false; await r.loadOlder();
                  requestAnimationFrame(() => { if (el) el.scrollTop = top + el.scrollHeight - height; });
                }}>{r.loadingOlder ? 'Loading older messages…' : 'Load older messages'}</button>}
              {r.loading && <p role="status">Loading history...</p>}
              {!r.loading && items.length === 0 && <p className="ch-note">No messages yet.</p>}
              {items.map((it) => {
                if (it.kind === 'gift') {
                  return <div className="ch-msg" key={it.id} data-testid={`gift-notice-${it.gift.id}`}>
                    <div><p><span style={{ color: it.gift.senderNameColor ?? '#FFFFFF' }}>{it.gift.senderName}</span> sent <span style={{ color: it.gift.recipientNameColor ?? '#FFFFFF' }}>{it.gift.recipientName}</span> a {it.gift.giftId === 'heart' ? 'Heart' : it.gift.giftId === 'moonfox' ? 'Moonfox' : it.gift.giftId === 'cosmic-encore' ? 'Cosmic Encore' : 'Spirit Pup'}.</p></div>
                  </div>;
                }
                if (it.kind === 'whisper') {
                  const w = it.w; const nm = nameOf(w.username, w.displayName);
                  return (
                    <div className="ch-msg ur-whisper" key={it.id} data-testid={`whisper-${w.id}`}>
                      <div><span className="ur-wlabel">{w.outgoing && 'You whisper to '}
                        <button type="button" className="ur-name" style={{ color: w.displayNameColor ?? nameColorOf(w.username) }} aria-haspopup="menu" aria-label={`Actions for ${nm}`} onClick={() => openMenu(w.username, nm, undefined, w.displayNameColor)}>{nm}</button>
                        {!w.outgoing && ' whispers to you'}</span><p>{w.body}</p></div>
                    </div>
                  );
                }
                const m = it.m; const nm = m.botId ? m.username : nameOf(m.username);
                if (m.botId) {
                  let body = m.text.trim();
                  for (const n of [nm, m.username]) if (n && body.toLowerCase().startsWith(n.toLowerCase())) { body = body.slice(n.length).replace(/^[\s:,\-–—]+/, ''); break; }
                  return (
                    <div className="ch-msg" key={m.id} data-testid={`bot-message-${m.id}`}>
                      <div><span className="ch-sender">{nm}<BotShield botId={m.botId} /></span><p>{body}</p></div>
                    </div>
                  );
                }
                const self = isSelf(m.username, m.authorId);
                const currentPerson = session?.people.find((p) => p.username === m.username);
                const displayNameColor = currentPerson?.displayNameColor ?? m.displayNameColor ?? '#FFFFFF';
                const badgeId = currentPerson?.badgeId !== undefined ? currentPerson.badgeId : m.badgeId ?? null;
                const badge = <BadgeMark id={badgeId ?? null}
                  label={badgeId ? `${badgeId === 'night-owl' ? 'Night Owl' : badgeId.replaceAll('-', ' ')} badge` : undefined}
                  size={16} compact />;
                return (
                  <div className="ch-msg" key={m.id}>
                    <div>
                       {self ? <span className="ch-sender" style={{ color: displayNameColor }}>{nm}{badge}</span>
                         : <button type="button" className="ch-sender ur-name" style={{ color: displayNameColor }} aria-haspopup="menu" aria-label={`Actions for ${nm}`} onClick={() => openMenu(m.username, nm, m.authorId, displayNameColor)}>{nm}{badge}</button>}
                      <p>{m.text}</p>
                      <div className="ch-acts"><button type="button" onClick={() => { setReporting(m); setNote(null); }}>Report</button>
                        <button type="button" disabled={block.isPending} onClick={() => block.mutate({ username: m.username, data: { kind: 'block', active: true } }, { onSuccess: () => { setNote(`Blocked ${m.username}.`); r.refresh(); }, onError: (e) => setNote(errMessage(e)) })}>Block</button></div>
                    </div>
                  </div>
                );
              })}
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
            {sendErr && <div className="ch-err" role="alert">{sendErr}</div>}
            {note && <p role="status">{note} <Link href="/community/blocks" className="bm-link">Blocked list</Link></p>}
            {whisperTo && (
              <div className="ur-chip" role="status">
                <span>Whispering to <b style={{ color: whisperTo.displayNameColor ?? '#FFFFFF' }}>{whisperTo.displayName}</b> · private</span>
                <button type="button" className="bm-btn bm-btn-sm" onClick={() => { setWhisperTo(null); setText(''); setSendErr(null); }} data-testid="button-whisper-close">Back to room</button>
              </div>
            )}
            <form className={`ch-comp${whispering ? ' ur-wmode' : ''}`} onSubmit={(e) => { e.preventDefault(); if (whispering) doWhisper(); else doSend(text); }}>
              <input type="text" value={text} maxLength={limit} onChange={(e) => setText(e.target.value)} placeholder={whispering ? 'Whisper (1-1000)' : 'Say something (1-280)'} aria-label={whispering ? 'Whisper' : 'Message'} data-testid="input-message" />
              <button type="submit" className="bm-btn bm-btn-primary" disabled={(whispering ? whisperMut.isPending : pending) || !text.trim()} data-testid="button-send">
                {whispering ? (whisperMut.isPending ? 'Sending...' : 'Whisper') : pending ? 'Sending...' : 'Send'}
              </button>
              {!whispering && <div className="ch-faces">{FACES.map((f) => <button key={f} type="button" disabled={pending} aria-label={`Send ${f}`} onClick={() => doSend(f, 'reaction')}>{f}</button>)}</div>}
            </form>
          </div>
        </div>
      </div>

      {menu && (
        <div className="ur-modal" onClick={() => setMenu(null)}>
          <div ref={menuBox} className="ur-menu" role="menu" aria-label={`Actions for ${menu.displayName}`} onClick={(e) => e.stopPropagation()}>
            <strong style={{ color: menu.displayNameColor ?? '#FFFFFF' }}>{menu.displayName}</strong>
            <button type="button" role="menuitem" onClick={() => { setGiftBag({ recipient: menu }); setMenu(null); setDrawer(false); }}>Gift</button>
            <button type="button" role="menuitem" onClick={() => { const u = menu.username; setMenu(null); nav(`/community/messages/${encodeURIComponent(u)}`); }}>Message</button>
            <button type="button" role="menuitem" onClick={() => {
              const message = [...r.messages].reverse().find(m => m.username === menu.username && !m.botId);
              setMenu(null); setDrawer(false);
              if (message) { setReporting(message); setDetails(''); }
              else setNote('Reports need a public chat message. No reportable message from this person is loaded; nothing has been reported.');
            }}>Report</button>
            <button type="button" role="menuitem" disabled={block.isPending} onClick={() => {
              const target = menu;
              setMenu(null);
              block.mutate({ username: target.username, data: { kind: 'block', active: true } }, {
                onSuccess: () => {
                  setNote(`Blocked ${target.displayName}.`);
                  qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith('/api/social') });
                  r.refresh();
                },
                onError: e => setNote(errMessage(e)),
              });
            }}>Block</button>
            <button type="button" role="menuitem" autoFocus onClick={() => { setWhisperTo(menu); setMenu(null); setDrawer(false); setText(''); setSendErr(null); }}>Whisper</button>
            <button type="button" role="menuitem" onClick={() => { const u = menu.username; setMenu(null); nav(`/community/people/${encodeURIComponent(u)}`); }}>View profile</button>
            <button type="button" role="menuitem" disabled={ignoreMut.isPending} onClick={() => toggleIgnore(menu)}>{ignored.has(menu.username) ? 'Unignore' : 'Ignore'}</button>
            <button type="button" role="menuitem" onClick={() => setMenu(null)}>Cancel</button>
          </div>
        </div>
      )}

      {giftBag && <GiftBag recipient={giftBag.recipient} recipients={giftRecipients} roomId={roomId} sessionId={sessionId} onClose={() => setGiftBag(null)} />}
      {gifts.animation && (gifts.animation.giftId === 'heart'
        ? <HeartAnimation key={gifts.animation.id} onFinish={gifts.finish} />
        : gifts.animation.giftId === 'cosmic-encore'
          ? <CosmicEncoreAnimation key={gifts.animation.id} onFinish={gifts.finish} />
        : gifts.animation.giftId === 'moonfox'
          ? <MoonfoxAnimation key={gifts.animation.id} onFinish={gifts.finish} />
          : <SpiritAnimation key={gifts.animation.id} onFinish={gifts.finish} />)}

      {rulesOpen && (
        <div className="ur-modal" onClick={dismissRules}>
          <div ref={rulesBox} className="ur-rules" role="dialog" aria-modal="true" aria-labelledby="ur-rules-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="ur-rules-title">House rules</h2>
            <p>{RULES}</p>
            {ack.isError && <div className="ch-err" role="alert">{errMessage(ack.error)}</div>}
            <div className="ur-rules-act">
              <button type="button" className="bm-btn" disabled={ack.isPending} onClick={dismissRules}>Close</button>
              <button type="button" className="bm-btn bm-btn-primary" autoFocus disabled={ack.isPending} data-testid="button-rules-ack"
                onClick={dismissRules}>{ack.isPending ? 'Saving...' : 'Got it'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
