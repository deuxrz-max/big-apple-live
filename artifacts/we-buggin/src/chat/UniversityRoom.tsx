import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Clapperboard, LockKeyhole, LogOut, Mic, MicOff, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetMyProfileQueryKey, getGetUniversitySessionQueryKey, useAcknowledgeUniversityRules, useGetUniversitySession,
  useGetChatAccess, useSendUniversityWhisper, useSetSocialRelationship, useSetUniversityIgnore,
  type ChatMessage, type StreamerPassportBadgeSummary,
  type RoomGiftEvent,
} from '@workspace/api-client-react';
import { UserPhoto } from '@/components/user-photo';
import { ShinyName } from '@/components/ShinyName';
import { errMessage, errStatus } from '@/lib/errors';
import { IdentityAvatar } from '@/lib/identity';
import { BadgeMark } from '@/social/common';
import { useTextRoom } from './useTextRoom';
import { BeamAudioTrack, useUniversityVideoBeam } from './useUniversityVideoBeam';
import { BeamTv, type BeamTvHandle } from './BeamTv';
import { BotShield } from './BotShield';
import { GiftBag, OPEN_ROOM_GIFTS_EVENT } from '@/gifts';
import { useRoomGifts } from '@/gifts/useRoomGifts';
import { GiftAnimationPlayer } from '@/gifts/GiftAnimationPlayer';
import { PassportSummaryBadge } from '@/passport/StreamerPassport';
import { RoomEntranceEffectOverlay } from './RoomEntranceEffectOverlay';
import { SafetyReportDialog } from '@/safety/SafetyReportDialog';
import type { RoomEntranceEffectEvent } from './useTextRoom';
import './university-room.css';
import './bot-moderation.css';

const RULES = "Stick to the room's topic. Be kind — no harassment or hate. Nothing sexual or explicit, in chat, names or photos. Don't share real names, phone numbers, addresses or other contact details. Don't hog the screen, no ALL CAPS, no ads or spam. Use Ignore on anyone bothering you, or Block and Report for anything serious. Public university chat is moderated by Streamtalk bots. Whispers and direct messages are private and are not scanned by these bots.";

type Target = { username: string; displayName: string; displayNameColor?: string; displayNameTierIndex?: number };
type ReportTarget = {
  targetType: 'user' | 'message';
  targetUsername: string;
  roomId: string;
  messageId?: string;
  messageText?: string;
};
type Item = { kind: 'room'; at: number; id: string; m: ChatMessage }
  | { kind: 'arrival'; at: number; id: string; displayName: string; participantId: string }
  | { kind: 'gift'; at: number; id: string; gift: RoomGiftEvent }
  | { kind: 'whisper'; at: number; id: string; w: { id: string; username: string; displayName: string;
      displayNameColor?: string; displayNameTierIndex?: number; badgeId?: string | null; badgeName?: string | null; badgeImage?: string | null;
      outgoing: boolean; body: string; passport?: StreamerPassportBadgeSummary } };

export function TextChatRoom({ roomId, userId }: { roomId: string; userId: string }) {
  const qc = useQueryClient();
  const [, nav] = useLocation();
  const r = useTextRoom(roomId, userId);
  const sessionId = r.creds?.participantSessionId ?? '';
  const participantId = r.creds?.participantId ?? '';
  const beamTvRef = useRef<BeamTvHandle>(null);
  const sessionKey = [...getGetUniversitySessionQueryKey(roomId), 'user', userId] as const;
  const headers = { 'X-Room-Session': sessionId };
  const uni = useGetUniversitySession(roomId, {
    request: { headers },
    query: { enabled: !!sessionId, refetchInterval: 3000, queryKey: sessionKey },
  });
  const session = uni.data;
  const blockedParticipantIds = useMemo(() => session?.people
    .filter(person => person.blocked).map(person => person.participantId) ?? [], [session?.people]);
  const videoBeam = useUniversityVideoBeam(roomId, sessionId, participantId, blockedParticipantIds);
  const activateRoomAudio = useCallback(() => {
    beamTvRef.current?.activateSoundFromUserGesture();
    if (videoBeam.playbackBlocked) void videoBeam.resumePlayback();
  }, [videoBeam.playbackBlocked, videoBeam.resumePlayback]);
  const micsLockedDuringVideo = videoBeam.beam.tv.micLockedDuringVideo;
  const ignoreMut = useSetUniversityIgnore({ request: { headers } });
  const whisperMut = useSendUniversityWhisper({ request: { headers } });
  const ack = useAcknowledgeUniversityRules();
  const block = useSetSocialRelationship();
  const chatAccess = useGetChatAccess();

  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [whisperTo, setWhisperTo] = useState<Target | null>(null);
  const [menu, setMenu] = useState<Target | null>(null);
  const [giftBag, setGiftBag] = useState<{ recipient: Target | null } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [activeEntranceEffect, setActiveEntranceEffect] = useState<RoomEntranceEffectEvent | null>(null);
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
  const messageLongPress = useRef<number | null>(null);
  const handledEntranceEffects = useRef(new Set<string>());
  const isComedyRoom = roomId.toUpperCase() === 'COMEDY';

  useEffect(() => {
    setText(''); setWhisperTo(null); setMenu(null); setDrawer(false); setRulesOpen(false);
    setGiftBag(null);
    setActiveEntranceEffect(null);
    handledEntranceEffects.current.clear();
    setIgnored(new Set()); setSendErr(null); setNote(null);
    autoRules.current = false; ignoreVersion.current = null; idem.current = null;
  }, [roomId, userId]);
  useEffect(() => {
    if (r.roomUnavailable) nav('/community');
  }, [r.roomUnavailable, nav]);
  useEffect(() => {
    for (const effect of r.entranceEffects) {
      if (handledEntranceEffects.current.has(effect.eventId)) continue;
      handledEntranceEffects.current.add(effect.eventId);
      const storageKey = `streamtalk-room-effect:${userId}:${effect.eventId}`;
      try {
        if (window.localStorage.getItem(storageKey)) continue;
        window.localStorage.setItem(storageKey, 'seen');
      } catch {
        // The in-memory set still prevents duplicates if storage is unavailable.
      }
      if (Date.now() - effect.startedAt < effect.durationMs) setActiveEntranceEffect(effect);
    }
  }, [r.entranceEffects, userId]);
  const finishEntranceEffect = useCallback((eventId: string) => {
    setActiveEntranceEffect(current => current?.eventId === eventId ? null : current);
  }, []);
  useEffect(() => {
    const openGifts = () => {
      setMenu(null);
      setDrawer(false);
      setGiftBag({ recipient: null });
    };
    window.addEventListener(OPEN_ROOM_GIFTS_EVENT, openGifts);
    return () => window.removeEventListener(OPEN_ROOM_GIFTS_EVENT, openGifts);
  }, []);
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
  const me = people.find((p) => p.self);
  const giftRecipients = people
    .filter(person => !person.botId && !person.blocked)
    .map(({ username, displayName, displayNameColor, displayNameTierIndex }) => ({ username, displayName, displayNameColor, displayNameTierIndex }));
  if (me && !giftRecipients.some(person => person.username.toLowerCase() === me.username.toLowerCase())) {
    giftRecipients.unshift({ username: me.username, displayName: me.displayName, displayNameColor: me.displayNameColor, displayNameTierIndex: me.displayNameTierIndex });
  }
  const beamSlots = [...videoBeam.beam.slots].sort((a, b) => a.slotNumber - b.slotNumber);
  const speakerCount = beamSlots.filter(slot => slot.participantId).length;
  const isSelf = (username: string, authorId?: string) => (!!authorId && authorId === r.creds?.participantId) || me?.username === username;
  const nameOf = (username: string, fallback?: string) => people.find((p) => p.username === username)?.displayName ?? fallback ?? username;
  const nameColorOf = (username: string, fallback?: string) => people.find((p) => p.username === username)?.displayNameColor ?? fallback ?? '#FFFFFF';

  const items = useMemo<Item[]>(() => {
    const a: Item[] = r.messages.filter((m) => m.botId || !ignored.has(m.username)).map((m) => ({ kind: 'room' as const, at: new Date(m.createdAt).getTime(), id: m.id, m }));
    const b: Item[] = (session?.whispers ?? []).filter((w) => !ignored.has(w.username)).map((w) => ({ kind: 'whisper' as const, at: new Date(w.createdAt).getTime(), id: `w-${w.id}`, w }));
    const c: Item[] = gifts.events.map(gift => ({ kind: 'gift', at: new Date(gift.createdAt).getTime(), id: `gift-${gift.id}`, gift }));
    const d: Item[] = r.arrivals.map(arrival => ({ kind: 'arrival', at: arrival.at, id: arrival.id,
      displayName: arrival.displayName, participantId: arrival.participantId }));
    return [...a, ...b, ...c, ...d].sort((x, y) => x.at - y.at || x.id.localeCompare(y.id));
  }, [r.messages, r.arrivals, session?.whispers, ignored, gifts.events]);
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
  const openMenu = (username: string, displayName: string, authorId?: string, displayNameColor?: string, displayNameTierIndex?: number) => {
    if (!isSelf(username, authorId)) setMenu({
      username, displayName,
      displayNameColor: displayNameColor ?? nameColorOf(username),
      displayNameTierIndex: displayNameTierIndex ?? people.find(person => person.username === username)?.displayNameTierIndex ?? 0,
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
          return (
            <li key={p.participantId}>
              <div className="ur-prow">
                {p.self ? <UserPhoto username={p.username} displayName={p.displayName} photoUrl={p.photoUrl} size={36} reviewStatus={p.photoStatus ?? undefined} /> :
                  <button type="button" className="ur-person-avatar" aria-label={`Actions for ${p.displayName}`} aria-haspopup="menu"
                    onClick={() => setMenu({ username: p.username, displayName: p.displayName, displayNameColor: p.displayNameColor ?? '#FFFFFF', displayNameTierIndex: p.displayNameTierIndex ?? 0 })}
                    data-testid={`button-person-avatar-${p.username}`}><UserPhoto username={p.username} displayName={p.displayName} photoUrl={p.photoUrl} size={36} /></button>}
                <span className="ur-pname">
                  {p.self
                    ? <span className="ur-pname-text"><ShinyName displayNameColor={p.displayNameColor} displayNameTierIndex={p.displayNameTierIndex}><BadgeMark id={p.badgeId ?? null} label={p.badgeName} imageUrl={p.badgeImage} size={16} compact />{p.displayName}</ShinyName><em> (you)</em></span>
                    : <button type="button" className="ur-pname-text ur-person-name-action" aria-haspopup="menu"
                        onClick={() => setMenu({ username: p.username, displayName: p.displayName, displayNameColor: p.displayNameColor ?? '#FFFFFF', displayNameTierIndex: p.displayNameTierIndex ?? 0 })}
                        data-testid={`button-person-${p.username}`}><ShinyName displayNameColor={p.displayNameColor} displayNameTierIndex={p.displayNameTierIndex}><BadgeMark id={p.badgeId ?? null} label={p.badgeName} imageUrl={p.badgeImage} size={16} compact />{p.displayName}</ShinyName></button>}
                  <PassportSummaryBadge passport={p.passport} username={p.username} context="people" />
                  {p.moderator && <span className="ur-badge">Moderator</span>}
                  {ign && <span className="ur-ign">Ignored</span>}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );

  if (r.roomUnavailable) {
    return <main className="ch ch-university ur" role="status">
      <p>This room is no longer available. Returning to the Directory.</p>
      <Link className="bm-btn bm-btn-primary" href="/community">Go to Directory</Link>
    </main>;
  }

  return (
    <div className={`ch ch-university ur${isComedyRoom ? ' ur-comedy' : ''}`}
      onPointerDownCapture={activateRoomAudio}
      onKeyDownCapture={activateRoomAudio}
      onWheelCapture={activateRoomAudio}>
      <div className="ch-in ur-in">
        {chatAccess.data?.warning && <p className="ur-moderation-notice" role="alert">{chatAccess.data.warning}</p>}
        {(chatAccess.data?.chatMuted || chatAccess.data?.reportsMuted) && (
          <p className="ur-moderation-notice" role="status">Chat is temporarily muted while a moderator reviews reports.</p>
        )}
        <div className="ur-head">
          <button type="button" ref={peopleBtn} className="bm-btn bm-btn-sm ur-people-btn" aria-haspopup="dialog" aria-expanded={drawer} onClick={() => setDrawer(true)} data-testid="button-people">People · {people.length}</button>
          <div className="ur-titlebox">
            <h1 className="ch-title ur-title" aria-label={r.room?.name ?? 'University'} data-testid="text-university-name">
              {isComedyRoom && <span className="ur-comedy-room-icon" aria-hidden="true">🎭</span>}
              {(r.room?.name ?? 'University').split(/\s+/).map((w, i) => (
                <span className="ch-word" key={`${w}-${i}`} style={{ animationDelay: `${i * 140}ms` }}>{w}</span>
              ))}
            </h1>
            {videoBeam.beam.tv.seriesTitle && videoBeam.beam.tv.seriesEpisodeNumber !== null && (
              <p className="ur-series-of-day" data-testid="text-series-of-day">
                {videoBeam.beam.tv.seriesTitle} · Episode {videoBeam.beam.tv.seriesEpisodeNumber}
              </p>
            )}
            {session?.topic && <p className="ur-topic" title={session.topic} data-testid="text-topic">{session.topic}</p>}
          </div>
          <button type="button" className="bm-btn bm-btn-sm ur-rules-btn" onClick={() => setRulesOpen(true)} data-testid="button-rules">Rules</button>
        </div>
        {r.error && <div className="ch-err" role="alert">{r.error} <Link href="/user-portal" className="bm-link">Profile</Link></div>}
        {r.overflow && <p><Link className="bm-btn bm-btn-primary" href={`/rooms/${encodeURIComponent(r.overflow.roomId)}`}>Enter {r.overflow.label}</Link></p>}
        <div className="ur-body">
          <aside ref={drawerBox} className={`ur-side${drawer ? ' is-open' : ''}`} role={drawer ? 'dialog' : undefined} aria-modal={drawer ? true : undefined} aria-labelledby="ur-people-title">
            {peopleList}
          </aside>
          {drawer && <div className="ur-backdrop" onClick={closeDrawer} aria-hidden="true" />}
          <div className="ch-room">
            <section className={`ur-beam${videoBeam.beam.tv.enabled ? ' is-tv-on' : ''}`} aria-label="Eight-slot LiveKit video beam">
              <div className="ur-audio-status-row">
                  <span className={`ur-audio-status ur-audio-${videoBeam.connection}`} role="status">
                  <span className="ur-status-dot" aria-hidden="true" />
                  {videoBeam.connection === 'connected' ? 'Audio ready'
                    : videoBeam.connection === 'connecting' ? 'Connecting'
                      : videoBeam.connection === 'error' ? 'Connection issue'
                        : videoBeam.beam.beamActive ? 'Joining live room' : 'Start the beam'}
                </span>
                {micsLockedDuringVideo && (
                  <span className="ur-mic-lock-indicator" role="status">
                    <LockKeyhole size={12} aria-hidden="true" /> Mics off during video
                  </span>
                )}
                {videoBeam.playbackBlocked && (
                  <span className="ur-room-sound-hint" role="status">Tap anywhere for sound</span>
                )}
              </div>
              <BeamTv ref={beamTvRef} roomName={r.room?.name ?? 'University'}
                tv={videoBeam.beam.tv} search={videoBeam.searchTv}
                reportPlaybackFailure={videoBeam.reportTvPlaybackFailure} />
              {isComedyRoom && (
                <div className="ur-comedy-toolbar" aria-label="Comedy room video controls">
                  <span className="ur-comedy-now" title={videoBeam.beam.tv.videoMetadata.find(item => item.videoId === videoBeam.beam.tv.currentVideoId)?.title ?? ''}>
                    <Clapperboard size={13} aria-hidden="true" />
                    <span>{videoBeam.beam.tv.videoMetadata.find(item => item.videoId === videoBeam.beam.tv.currentVideoId)?.title ?? 'Comedy videos'}</span>
                  </span>
                </div>
              )}
              {videoBeam.error && <p className="ur-beam-error" role="alert">{videoBeam.error}</p>}
              {videoBeam.beam.beamActive && !videoBeam.ownSlot && beamSlots.every(slot => slot.participantId)
                && <p className="ur-beam-full" role="status">Beam is full. You can still watch and chat; an open spot can be joined as soon as someone leaves.</p>}
                  <div className="ur-slots" data-count={speakerCount} data-tv={videoBeam.beam.tv.enabled ? 'on' : 'off'}>
                {beamSlots.map((slot) => {
                  const person = slot.participantId
                    ? people.find((p) => p.participantId === slot.participantId)
                    : undefined;
                  const mine = slot.participantId === participantId;
                  const joinAvailable = !slot.participantId && !!sessionId && !!participantId && !videoBeam.ownSlot;
                  const isSpeaking = !!slot.participantId && videoBeam.speaking.has(slot.participantId);
                    const media = slot.participantId ? videoBeam.media[slot.participantId] : undefined;
                  return (
                    <article className={`ur-slot${isSpeaking ? ' is-speaking' : ''}${slot.participantId ? ' is-occupied' : ''}`}
                      key={slot.slotNumber} aria-label={`Speaker slot ${slot.slotNumber}${slot.participantId ? `, ${person?.displayName ?? 'occupied'}` : ', empty'}`}>
                      <div className="ur-slot-media"
                        role={joinAvailable && !videoBeam.busy ? 'button' : undefined}
                        tabIndex={joinAvailable && !videoBeam.busy ? 0 : undefined}
                        aria-label={joinAvailable && !videoBeam.busy ? `Join open speaker spot ${slot.slotNumber}` : undefined}
                        onClick={joinAvailable && !videoBeam.busy ? () => void videoBeam.joinSpeaker() : undefined}
                        onKeyDown={joinAvailable && !videoBeam.busy ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            void videoBeam.joinSpeaker();
                          }
                        } : undefined}>
                        {person && <BeamAudioTrack track={media?.audio} />}
                        {person && (slot.micMuted || slot.mutedByHost || micsLockedDuringVideo) && (
                          <span className="ur-slot-mic-icon" role="img"
                            aria-label={micsLockedDuringVideo ? 'Microphone locked off during video' : 'Microphone muted'}
                            title={micsLockedDuringVideo ? 'Microphone locked off during video' : 'Microphone muted'}>
                            {micsLockedDuringVideo ? <LockKeyhole size={13} aria-hidden="true" /> : <MicOff size={13} aria-hidden="true" />}
                          </span>
                        )}
                        {person && !person.self && (person.photoUrl || person.identity) && (
                          <button type="button" className="ur-slot-avatar-button"
                            aria-label={`Actions for ${person.displayName}`}
                            onClick={event => { event.stopPropagation(); openMenu(person.username, person.displayName, person.participantId, person.displayNameColor); }}>
                            {person.photoUrl ? (
                              <span className="ur-slot-avatar ur-slot-photo" aria-hidden="true">
                                <UserPhoto username={person.username} displayName={person.displayName}
                                  photoUrl={person.photoUrl} size={46} />
                              </span>
                            ) : person.identity ? (
                              <IdentityAvatar identity={person.identity} size={46} className="ur-slot-avatar ur-slot-art" />
                            ) : null}
                          </button>
                        )}
                        {person && !person.self && !person.identity && !person.photoUrl && (
                          <button type="button" className="ur-slot-avatar ur-slot-initial ur-slot-avatar-button"
                            aria-label={`Actions for ${person.displayName}`}
                            onClick={event => { event.stopPropagation(); openMenu(person.username, person.displayName, person.participantId, person.displayNameColor); }}>
                            {person.displayName.slice(0, 1)}
                          </button>
                        )}
                        {person?.self && (person.photoUrl ? (
                          <span className="ur-slot-avatar ur-slot-photo" aria-hidden="true">
                            <UserPhoto username={person.username} displayName={person.displayName} photoUrl={person.photoUrl} size={46} />
                          </span>
                        ) : person.identity ? <IdentityAvatar identity={person.identity} size={46} className="ur-slot-avatar ur-slot-art" /> : (
                          <span className="ur-slot-avatar ur-slot-initial" aria-hidden="true">{person.displayName.slice(0, 1)}</span>
                        ))}
                        {person ? (
                          <div className="ur-slot-copy">
                            <span className="ur-slot-name-line">
                              <BadgeMark id={person.badgeId ?? null} label={person.badgeName} imageUrl={person.badgeImage} size={16} compact />
                              {person.self ? <ShinyName className="ur-slot-name" displayNameColor={person.displayNameColor} displayNameTierIndex={person.displayNameTierIndex}>{person.displayName}</ShinyName>
                                : <button type="button" className="ur-name ur-slot-name"
                                  aria-label={`Actions for ${person.displayName}`}
                                  onClick={event => { event.stopPropagation(); openMenu(person.username, person.displayName, person.participantId, person.displayNameColor, person.displayNameTierIndex); }}>
                                  <ShinyName displayNameColor={person.displayNameColor} displayNameTierIndex={person.displayNameTierIndex}>{person.displayName}</ShinyName>
                                </button>}
                            </span>
                          </div>
                        ) : slot.participantId ? (
                          <div className="ur-slot-copy">
                            <span className="ur-slot-name">Speaker details loading</span>
                            <span className="ur-slot-caption">Syncing room roster</span>
                          </div>
                        ) : (
                          <div className="ur-slot-empty-copy">
                            <span className="ur-empty-number" aria-hidden="true">{slot.slotNumber}</span>
                            <span className="ur-slot-name ur-empty-name">{joinAvailable ? 'Tap to join' : 'Open spot'}</span>
                          </div>
                        )}
                      </div>
                      {person && !mine && videoBeam.isHost ? (
                        <div className="ur-slot-actions">
                          <button type="button" className="ur-slot-action"
                            disabled={videoBeam.busy || slot.micMuted || micsLockedDuringVideo}
                            aria-label={micsLockedDuringVideo
                              ? `${person.displayName}'s microphone is locked off during the video`
                              : `Mute ${person.displayName}'s microphone`}
                            title={micsLockedDuringVideo
                              ? `${person.displayName}'s microphone is locked off during the video`
                              : `Mute ${person.displayName}'s microphone`}
                            onClick={() => void videoBeam.hostMuteMic(slot.participantId!)}>
                            {micsLockedDuringVideo ? <LockKeyhole size={16} /> : <MicOff size={16} />}
                          </button>
                          <button type="button" className="ur-slot-action ur-slot-leave" disabled={videoBeam.busy}
                            aria-label={`Remove ${person.displayName} from the beam`} title={`Remove ${person.displayName} from the beam`}
                            onClick={() => void videoBeam.kick(slot.participantId!)}><X size={16} /></button>
                        </div>
                      ) : !person && slot.participantId ? <span className="ur-slot-caption">Syncing room roster</span> : null}
                    </article>
                  );
                })}
              </div>
              {videoBeam.ownSlot && (
                <div className="ur-beam-self-controls" role="group" aria-label="Your beam controls">
                  <button type="button" className="ur-slot-action"
                    disabled={videoBeam.busy || micsLockedDuringVideo}
                    aria-pressed={!videoBeam.ownSlot.micMuted && !micsLockedDuringVideo}
                    aria-label={micsLockedDuringVideo ? 'Microphone locked off during video'
                      : videoBeam.ownSlot.micMuted ? 'Turn microphone on' : 'Mute microphone'}
                    title={micsLockedDuringVideo ? 'Microphone locked off during video'
                      : videoBeam.ownSlot.micMuted ? 'Turn microphone on' : 'Mute microphone'}
                    onClick={() => void videoBeam.toggleMic(videoBeam.ownSlot!.micMuted)}>
                    {micsLockedDuringVideo ? <LockKeyhole size={16} />
                      : videoBeam.ownSlot.micMuted ? <MicOff size={16} /> : <Mic size={16} />}
                    {micsLockedDuringVideo ? 'Locked' : videoBeam.ownSlot.micMuted ? 'Unmute' : 'Mute'}
                  </button>
                  <button type="button" className="ur-slot-action ur-slot-leave"
                    disabled={videoBeam.busy} onClick={() => void videoBeam.leaveSlot()}
                    aria-label="Leave beam" title="Leave beam">
                    <LogOut size={16} /> Leave
                  </button>
                </div>
              )}
            </section>
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
                     <div><p><span className="ur-gift-person"><BadgeMark id={it.gift.senderBadgeId ?? null} label={it.gift.senderBadgeName} imageUrl={it.gift.senderBadgeImage} size={16} compact /><button type="button" className="ur-name" onClick={() => openMenu(it.gift.senderUsername, it.gift.senderName, undefined, it.gift.senderNameColor, it.gift.senderNameTierIndex)}><ShinyName displayNameColor={it.gift.senderNameColor} displayNameTierIndex={it.gift.senderNameTierIndex}>{it.gift.senderName}</ShinyName></button><PassportSummaryBadge passport={it.gift.senderPassport} username={it.gift.senderUsername} context={`gift-sender-${it.gift.id}`} /></span> sent <span className="ur-gift-person"><BadgeMark id={it.gift.recipientBadgeId ?? null} label={it.gift.recipientBadgeName} imageUrl={it.gift.recipientBadgeImage} size={16} compact /><button type="button" className="ur-name" onClick={() => openMenu(it.gift.recipientUsername, it.gift.recipientName, undefined, it.gift.recipientNameColor, it.gift.recipientNameTierIndex)}><ShinyName displayNameColor={it.gift.recipientNameColor} displayNameTierIndex={it.gift.recipientNameTierIndex}>{it.gift.recipientName}</ShinyName></button><PassportSummaryBadge passport={it.gift.recipientPassport} username={it.gift.recipientUsername} context={`gift-recipient-${it.gift.id}`} /></span> a {it.gift.giftName}.</p></div>
                  </div>;
                }
                if (it.kind === 'arrival') {
                  const arrivalPerson = session?.people.find(person => person.participantId === it.participantId);
                  return <div className="ch-msg ur-arrival-line" key={it.id} data-testid="room-arrival">
                    <div><BadgeMark id={arrivalPerson?.badgeId ?? null} label={arrivalPerson?.badgeName} imageUrl={arrivalPerson?.badgeImage} size={16} compact />{arrivalPerson
                      ? <button type="button" className="ur-name" onClick={() => openMenu(arrivalPerson.username, it.displayName, it.participantId, arrivalPerson.displayNameColor, arrivalPerson.displayNameTierIndex)}><ShinyName displayNameColor={arrivalPerson.displayNameColor} displayNameTierIndex={arrivalPerson.displayNameTierIndex}>{it.displayName}</ShinyName></button>
                      : <ShinyName>{it.displayName}</ShinyName>} has <strong className="ur-arrived-word">arrived</strong></div>
                  </div>;
                }
                if (it.kind === 'whisper') {
                  const w = it.w; const nm = nameOf(w.username, w.displayName);
                  return (
                    <div className="ch-msg ur-whisper" key={it.id} data-testid={`whisper-${w.id}`}>
                      <div><span className="ur-wlabel">{w.outgoing && 'You whisper to '}
                        <BadgeMark id={w.badgeId ?? null} label={w.badgeName} imageUrl={w.badgeImage} size={16} compact />
                        <button type="button" className="ur-name" aria-haspopup="menu" aria-label={`Actions for ${nm}`} onClick={() => openMenu(w.username, nm, undefined, w.displayNameColor, w.displayNameTierIndex)}><ShinyName displayNameColor={w.displayNameColor ?? nameColorOf(w.username)} displayNameTierIndex={w.displayNameTierIndex ?? people.find(person => person.username === w.username)?.displayNameTierIndex}>{nm}</ShinyName></button>
                        <PassportSummaryBadge passport={w.passport} username={w.username} context={`whisper-${w.id}`} />
                        {!w.outgoing && ' whispers to you'}</span><p>{w.body}</p></div>
                    </div>
                  );
                }
                const m = it.m; const nm = m.botId ? m.username : nameOf(m.username);
                if (m.botId) {
                  let body = m.text.trim();
                  for (const n of [nm, m.username]) if (n && body.toLowerCase().startsWith(n.toLowerCase())) { body = body.slice(n.length).replace(/^[\s:,\-–—]+/, ''); break; }
                  if (m.botMessageType === 'visit' && body.trim().replace(/[.!?]+$/, '').toLowerCase() === 'has arrived') {
                    return <div className="ch-msg ur-arrival-line" key={m.id} data-testid={`bot-arrival-${m.id}`}>
                      <div><span>{nm}</span> <BotShield botId={m.botId} /> has <strong className="ur-arrived-word">arrived</strong></div>
                    </div>;
                  }
                  return (
                    <div className={`ch-msg${m.botMessageType === 'chatter' ? ' ur-bot-chatter' : ''}`} key={m.id} data-testid={`bot-message-${m.id}`}>
                      <div>
                        <span className="ch-sender">{nm}<BotShield botId={m.botId} />
                          {m.botMessageType === 'chatter' && <span className="ur-bot-tag" aria-label="Bot account">BOT</span>}
                        </span>
                        <p>{body}</p>
                      </div>
                    </div>
                  );
                }
                const self = isSelf(m.username, m.authorId);
                const currentPerson = session?.people.find((p) => p.username === m.username);
                const displayNameColor = currentPerson?.displayNameColor ?? m.displayNameColor ?? '#FFFFFF';
                const displayNameTierIndex = currentPerson?.displayNameTierIndex ?? m.displayNameTierIndex ?? 0;
                const badgeId = m.badgeId ?? null;
                const badge = <BadgeMark id={badgeId ?? null} label={m.badgeName} imageUrl={m.badgeImage} size={16} compact />;
                const passportBadge = <PassportSummaryBadge passport={currentPerson?.passport ?? m.passport} username={m.username} context={`message-${m.id}`} />;
                return (
                  <div className="ch-msg" key={m.id}
                    onContextMenu={event => {
                      if (self) return;
                      event.preventDefault();
                      setReporting({ targetType: 'message', targetUsername: m.username, roomId,
                        messageId: m.id, messageText: m.text });
                    }}
                    onTouchStart={() => {
                      if (self) return;
                      if (messageLongPress.current) window.clearTimeout(messageLongPress.current);
                      messageLongPress.current = window.setTimeout(() => setReporting({
                        targetType: 'message', targetUsername: m.username, roomId, messageId: m.id, messageText: m.text,
                      }), 600);
                    }}
                    onTouchMove={() => {
                      if (messageLongPress.current) window.clearTimeout(messageLongPress.current);
                      messageLongPress.current = null;
                    }}
                    onTouchEnd={() => {
                      if (messageLongPress.current) window.clearTimeout(messageLongPress.current);
                      messageLongPress.current = null;
                    }}
                    onTouchCancel={() => {
                      if (messageLongPress.current) window.clearTimeout(messageLongPress.current);
                      messageLongPress.current = null;
                    }}>
                    <div>
                       {self ? <span className="ch-sender"><ShinyName displayNameColor={displayNameColor} displayNameTierIndex={displayNameTierIndex}>{badge}{nm}</ShinyName>{passportBadge}</span>
                          : <span className="ch-sender"><button type="button" className="ur-name" aria-haspopup="menu" aria-label={`Actions for ${nm}`} onClick={() => openMenu(m.username, nm, m.authorId, displayNameColor, displayNameTierIndex)}><ShinyName displayNameColor={displayNameColor} displayNameTierIndex={displayNameTierIndex}>{badge}{nm}</ShinyName></button>{passportBadge}</span>}
                      <p>{m.text}</p>
                       {!self && <div className="ch-acts"><button type="button" onClick={() => { setReporting({
                         targetType: 'message', targetUsername: m.username, roomId, messageId: m.id, messageText: m.text,
                       }); setNote(null); }}>Report message</button>
                        <button type="button" disabled={block.isPending} onClick={() => block.mutate({ username: m.username, data: { kind: 'block', active: true } }, { onSuccess: () => { setNote(`Blocked ${m.username}.`); r.refresh(); }, onError: (e) => setNote(errMessage(e)) })}>Block</button></div>
                       }
                    </div>
                  </div>
                );
              })}
            </div>
            {reporting && <SafetyReportDialog {...reporting} roomSessionId={sessionId}
              onClose={() => setReporting(null)} onSubmitted={() => setNote(null)} />}
            {sendErr && <div className="ch-err" role="alert">{sendErr}</div>}
            {note && <p role="status">{note} <Link href="/community/blocks" className="bm-link">Blocked list</Link></p>}
            {whisperTo && (
              <div className="ur-chip" role="status">
                <span>Whispering to <b><ShinyName displayNameColor={whisperTo.displayNameColor} displayNameTierIndex={whisperTo.displayNameTierIndex}>{whisperTo.displayName}</ShinyName></b> · private</span>
                <button type="button" className="bm-btn bm-btn-sm" onClick={() => { setWhisperTo(null); setText(''); setSendErr(null); }} data-testid="button-whisper-close">Back to room</button>
              </div>
            )}
            <form className={`ch-comp${whispering ? ' ur-wmode' : ''}`} onSubmit={(e) => { e.preventDefault(); if (whispering) doWhisper(); else doSend(text); }}>
              <input type="text" value={text} maxLength={limit} onChange={(e) => setText(e.target.value)} placeholder={whispering ? 'Whisper (1-1000)' : 'Say something (1-280)'} aria-label={whispering ? 'Whisper' : 'Message'} data-testid="input-message" />
              <button type="submit" className="bm-btn bm-btn-primary" disabled={(whispering ? whisperMut.isPending : pending) || !text.trim()} data-testid="button-send">
                {whispering ? (whisperMut.isPending ? 'Sending...' : 'Whisper') : pending ? 'Sending...' : 'Send'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {menu && (
        <div className="ur-modal" onClick={() => setMenu(null)}>
          <div ref={menuBox} className="ur-menu" role="menu" aria-label={`Actions for ${menu.displayName}`} onClick={(e) => e.stopPropagation()}>
            <strong><ShinyName displayNameColor={menu.displayNameColor} displayNameTierIndex={menu.displayNameTierIndex}>{menu.displayName}</ShinyName></strong>
            <button type="button" role="menuitem" onClick={() => { setGiftBag({ recipient: menu }); setMenu(null); setDrawer(false); }}>Gift</button>
            <button type="button" role="menuitem" onClick={() => { const u = menu.username; setMenu(null); nav(`/community/messages/${encodeURIComponent(u)}`); }}>Message</button>
             <button type="button" role="menuitem" onClick={() => {
               setReporting({ targetType: 'user', targetUsername: menu.username, roomId });
               setMenu(null); setDrawer(false);
             }}>Report user</button>
            <button type="button" role="menuitem" disabled={block.isPending} onClick={() => {
              const target = menu;
              setMenu(null);
              block.mutate({ username: target.username, data: { kind: 'block', active: true } }, {
                onSuccess: () => {
                  setNote(`Blocked ${target.displayName}.`);
                  qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith('/api/social') });
                  qc.invalidateQueries({ queryKey: getGetUniversitySessionQueryKey(roomId) });
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
      {gifts.animation && <GiftAnimationPlayer
        key={gifts.animation.id}
        giftId={gifts.animation.giftId as import('@workspace/api-client-react').GiftStudioGiftId}
        senderName={gifts.animation.senderName}
        senderNameColor={gifts.animation.senderNameColor}
        senderNameTierIndex={gifts.animation.senderNameTierIndex}
        onFinish={gifts.finish}
      />}

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
      <RoomEntranceEffectOverlay event={activeEntranceEffect} onFinish={finishEntranceEffect} />
    </div>
  );
}
