import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Clapperboard, LogOut, Mic, MicOff, Send, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { RoomChannelBack } from './RoomChannels';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetMyProfileQueryKey, getGetUniversitySessionQueryKey, useAcknowledgeUniversityRules, useGetUniversitySession,
  useGetChatAccess, useSendUniversityWhisper, useSetSocialRelationship, useSetUniversityIgnore,
  type ChatMessage,
  type RoomGiftEvent,
} from '@workspace/api-client-react';
import { photoSrc, UserPhoto } from '@/components/user-photo';
import { useQuickProfile } from '@/profile/QuickProfile';
import { ShinyName } from '@/components/ShinyName';
import { errMessage, errStatus } from '@/lib/errors';
import { IdentityAvatar } from '@/lib/identity';
import { BadgeMark } from '@/social/common';
import { useTextRoom } from './useTextRoom';
import { BeamAudioTrack, useUniversityVideoBeam } from './useUniversityVideoBeam';
import { isBeamMicEnabled } from './beam-audio-policy';
import { arrangeVideoBeamSeats } from './video-beam-seat-layout';
import { BeamTv, type BeamTvHandle } from './BeamTv';
import { BotShield } from './BotShield';
import { BotActivityLine } from './BotActivityLine';
import { GiftBag, OPEN_ROOM_GIFTS_EVENT } from '@/gifts';
import { useRoomGifts } from '@/gifts/useRoomGifts';
import { GiftComboPlayer } from '@/gifts/GiftComboPlayer';
import { RoomEntranceEffectOverlay } from './RoomEntranceEffectOverlay';
import { SafetyReportDialog } from '@/safety/SafetyReportDialog';
import type { RoomCoinDropEvent, RoomEntranceEffectEvent } from './useTextRoom';
import { RoomCoinDropOverlay } from './RoomCoinDropOverlay';
import { giftingTier } from '@workspace/beam-identity';
import { giftingPerks, normalizeGiftingLevel } from '@/gifting/gifting';
import { GiftingEntranceOverlay, type GiftingArrival } from '@/gifting/GiftingCelebrations';
import { CardHandFan } from './CardHandFan';
import { canUsePremiumCardFinish } from './card-surface-finish';
import { OwnerCardGameTestMode, type OwnerCardTestState } from './OwnerCardGameTestMode';
import './university-room.css';
import { RoomPerimeter } from './RoomPerimeter';
import './bot-moderation.css';

const RULES = "Stick to the room's topic. Be kind — no harassment or hate. Nothing sexual or explicit, in chat, names or photos. Don't share real names, phone numbers, addresses or other contact details. Don't hog the screen, no ALL CAPS, no ads or spam. Use Ignore on anyone bothering you, or Block and Report for anything serious. Public room chat is moderated by Big Apple Live bots. Whispers and direct messages are private and are not scanned by these bots.";

type Target = {
  username: string;
  displayName: string;
  participantId?: string;
  botId?: string | null;
  displayNameColor?: string;
  displayNameTierIndex?: number;
  photoUrl?: string | null;
  isHost?: boolean;
};
type CardGamePersonView = {
  cards: Array<{ card: { rank: number; suit: 'C' | 'D' | 'H' | 'S' | null; jokerId?: number } }>;
};
type CardHandLookup = { participantId: string; status: 'loading' | 'ready' | 'error'; cards: string[] };
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
      outgoing: boolean; body: string } };

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
  const videoBeam = useUniversityVideoBeam(roomId, sessionId, participantId);
  const activateRoomAudio = useCallback(() => {
    beamTvRef.current?.activateSoundFromUserGesture();
    if (videoBeam.playbackBlocked) void videoBeam.resumePlayback();
  }, [videoBeam.playbackBlocked, videoBeam.resumePlayback]);
  const ownMicEnabled = isBeamMicEnabled(videoBeam.ownSlot);
  const toggleOwnMic = useCallback((enabled: boolean) => {
    const previousMicState = ownMicEnabled;
    beamTvRef.current?.setMicrophoneAudioMode(enabled);
    void videoBeam.toggleMic(enabled).then(succeeded => {
      if (!succeeded) beamTvRef.current?.setMicrophoneAudioMode(previousMicState);
    });
  }, [ownMicEnabled, videoBeam.toggleMic]);
  const leaveOwnSeat = useCallback(() => {
    const previousMicState = ownMicEnabled;
    beamTvRef.current?.setMicrophoneAudioMode(false);
    void videoBeam.leaveSlot().then(succeeded => {
      if (!succeeded && previousMicState) beamTvRef.current?.setMicrophoneAudioMode(true);
    });
  }, [ownMicEnabled, videoBeam.leaveSlot]);
  const ignoreMut = useSetUniversityIgnore({ request: { headers } });
  const whisperMut = useSendUniversityWhisper({ request: { headers } });
  const ack = useAcknowledgeUniversityRules();
  const block = useSetSocialRelationship();
  const chatAccess = useGetChatAccess();
  const quickProfile = useQuickProfile();

  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [whisperTo, setWhisperTo] = useState<Target | null>(null);
  const [menu, setMenu] = useState<Target | null>(null);
  const [cardHandLookup, setCardHandLookup] = useState<CardHandLookup | null>(null);
  const [ownerCardTestState, setOwnerCardTestState] = useState<OwnerCardTestState | null>(null);
  const [giftBag, setGiftBag] = useState<{ recipient: Target | null } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [activeEntranceEffect, setActiveEntranceEffect] = useState<RoomEntranceEffectEvent | null>(null);
  const [coinDropQueue, setCoinDropQueue] = useState<RoomCoinDropEvent[]>([]);
  const [giftingArrivals, setGiftingArrivals] = useState<GiftingArrival[]>([]);
  const handledGiftingArrivals = useRef(new Set<string>());
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
  const handledCoinDrops = useRef(new Set<string>());
  const isComedyRoom = roomId.toUpperCase() === 'COMEDY';
  const isSocialRoom = r.room?.roomType === 'social';

  useEffect(() => {
    if (!isSocialRoom || !menu?.participantId || !sessionId) {
      setCardHandLookup(null);
      return;
    }
    const targetParticipantId = menu.participantId;
    let active = true;
    let loading = false;
    setCardHandLookup({ participantId: targetParticipantId, status: 'loading', cards: [] });
    const loadHand = async () => {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}api/account/rooms/${encodeURIComponent(roomId)}/card-game/participants/${encodeURIComponent(targetParticipantId)}`,
          { credentials: 'include', cache: 'no-store', headers: { 'X-Room-Session': sessionId } },
        );
        if (!response.ok) throw new Error('Could not load this hand.');
        const view = await response.json() as CardGamePersonView;
        const rankCode: Record<number, string> = {
          3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
          10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
        };
        if (active) setCardHandLookup({
          participantId: targetParticipantId,
          status: 'ready',
          cards: view.cards.map(item => item.card.jokerId !== undefined
            ? `joker-wild-${item.card.jokerId}`
            : `${rankCode[item.card.rank]}${item.card.suit}`),
        });
      } catch {
        if (active) setCardHandLookup({ participantId: targetParticipantId, status: 'error', cards: [] });
      } finally {
        loading = false;
      }
    };
    void loadHand();
    const timer = window.setInterval(() => void loadHand(), 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [isSocialRoom, menu?.participantId, roomId, sessionId]);

  useEffect(() => {
    setText(''); setWhisperTo(null); setMenu(null); setDrawer(false); setRulesOpen(false);
    setGiftBag(null);
    setCardHandLookup(null); setOwnerCardTestState(null);
    setActiveEntranceEffect(null);
    setCoinDropQueue([]);
    setGiftingArrivals([]);
    handledGiftingArrivals.current.clear();
    handledEntranceEffects.current.clear();
    handledCoinDrops.current.clear();
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
  useEffect(() => {
    for (const event of r.coinDrops) {
      if (handledCoinDrops.current.has(event.eventId)) continue;
      handledCoinDrops.current.add(event.eventId);
      const storageKey = `deux-wild-coin-drop:${userId}:${event.eventId}`;
      try {
        if (window.localStorage.getItem(storageKey)) continue;
        window.localStorage.setItem(storageKey, 'seen');
      } catch {
        // In-memory event de-duplication still protects this page session.
      }
      if (Date.now() - event.startedAt <= 30_000) {
        setCoinDropQueue(previous => [...previous, event]);
      }
    }
  }, [r.coinDrops, userId]);
  // Tier entrance perks (Gold+) ride the existing arrival plumbing: each arrival id
  // plays once, only while fresh, so polling/reconnects never replay it.
  useEffect(() => {
    const roster = session?.people ?? [];
    for (const arrival of r.arrivals) {
      if (handledGiftingArrivals.current.has(arrival.id)) continue;
      const person = roster.find(p => p.participantId === arrival.participantId);
      if (!person) continue;
      handledGiftingArrivals.current.add(arrival.id);
      const level = normalizeGiftingLevel(person.displayNameTierIndex);
      if (!giftingPerks(level).entranceBanner || Date.now() - arrival.at > 15_000) continue;
      setGiftingArrivals(previous => previous.length >= 3 ? previous
        : [...previous, { id: arrival.id, at: arrival.at, displayName: arrival.displayName, level }]);
    }
  }, [r.arrivals, session?.people]);
  const finishGiftingArrival = useCallback((id: string) => {
    setGiftingArrivals(current => current.filter(item => item.id !== id));
  }, []);
  const finishEntranceEffect = useCallback((eventId: string) => {
    setActiveEntranceEffect(current => current?.eventId === eventId ? null : current);
  }, []);
  const finishCoinDrop = useCallback((eventId: string) => {
    setCoinDropQueue(current => current[0]?.eventId === eventId
      ? current.slice(1)
      : current.filter(item => item.eventId !== eventId));
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
  const beamSlots = [...videoBeam.beam.slots].sort((a, b) => a.slotNumber - b.slotNumber);
  const roomHostParticipantId = isSocialRoom
    ? r.room?.hostParticipantId ?? videoBeam.beam.hostParticipantId
    : videoBeam.beam.hostParticipantId;
  const canModerateRoom = !!me?.moderator
    || (isSocialRoom && !!participantId && roomHostParticipantId === participantId);
  const isOwnerCardTestUser = isSocialRoom && me?.username.trim().toLowerCase() === 'vampsquad'
    && !!participantId && participantId === roomHostParticipantId;
  const handleOwnSeatTap = () => toggleOwnMic(!ownMicEnabled);
  const menuIsSelf = !!me && menu?.username.toLowerCase() === me.username.toLowerCase();
  const isPrivateTestHand = !!menu && !!participantId && menu.participantId === participantId
    && !!ownerCardTestState?.enabled && ownerCardTestState.eligible;
  const profileHandCards = isPrivateTestHand
    ? ownerCardTestState.cards.map(card => card.code)
    : cardHandLookup && cardHandLookup.participantId === menu?.participantId && cardHandLookup.status === 'ready'
      ? cardHandLookup.cards
      : [];
  const profileHandLoading = !!menu?.participantId && !isPrivateTestHand
    && cardHandLookup?.participantId === menu.participantId && cardHandLookup.status === 'loading';
  const profileHandError = !!menu?.participantId && !isPrivateTestHand
    && cardHandLookup?.participantId === menu.participantId && cardHandLookup.status === 'error';
  const beamSeatLayout = arrangeVideoBeamSeats(beamSlots, roomHostParticipantId);
  const peopleByParticipantId = new Map(people.map(person => [person.participantId, person]));
  const giftRecipients = beamSlots.flatMap(slot => {
    if (!slot.participantId) return [];
    const person = peopleByParticipantId.get(slot.participantId);
    if (!person || person.botId) return [];
    return [{
      username: person.username,
      displayName: person.displayName,
      displayNameColor: person.displayNameColor,
      displayNameTierIndex: person.displayNameTierIndex,
      photoUrl: person.photoUrl,
    }];
  });
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
    const person = people.find(candidate => candidate.username.toLowerCase() === username.toLowerCase());
    if (!isSelf(username, authorId) || isSocialRoom) setMenu({
      username, displayName,
      participantId: person?.participantId,
      botId: person?.botId,
      photoUrl: person?.photoUrl ?? null,
      displayNameColor: displayNameColor ?? nameColorOf(username),
      displayNameTierIndex: displayNameTierIndex ?? person?.displayNameTierIndex ?? 0,
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
                {<button type="button" className="ur-person-avatar" aria-label={`${isSocialRoom ? 'Profile and cards for' : 'Open profile for'} ${p.displayName}`}
                    aria-haspopup="dialog"
                    onClick={() => isSocialRoom
                      ? openMenu(p.username, p.displayName, p.participantId, p.displayNameColor, p.displayNameTierIndex)
                      : quickProfile?.open(p.username)}
                    data-testid={`button-person-avatar-${p.username}`}><UserPhoto username={p.username} displayName={p.displayName} photoUrl={p.photoUrl} size={36} reviewStatus={p.photoStatus ?? undefined} /></button>}
                <span className="ur-pname">
                  {p.self
                    ? isSocialRoom
                      ? <button type="button" className="ur-pname-text ur-person-name-action" aria-haspopup="dialog"
                          onClick={() => openMenu(p.username, p.displayName, p.participantId, p.displayNameColor, p.displayNameTierIndex)}>
                          <ShinyName displayNameColor={p.displayNameColor} displayNameTierIndex={p.displayNameTierIndex}><BadgeMark id={p.badgeId ?? null} label={p.badgeName} imageUrl={p.badgeImage} size={16} compact />{p.displayName}</ShinyName><em> (you)</em>
                        </button>
                      : <span className="ur-pname-text"><ShinyName displayNameColor={p.displayNameColor} displayNameTierIndex={p.displayNameTierIndex}><BadgeMark id={p.badgeId ?? null} label={p.badgeName} imageUrl={p.badgeImage} size={16} compact />{p.displayName}</ShinyName><em> (you)</em></span>
                    : <button type="button" className="ur-pname-text ur-person-name-action"
                        aria-haspopup={isSocialRoom ? 'dialog' : 'menu'}
                        onClick={() => openMenu(p.username, p.displayName, p.participantId, p.displayNameColor, p.displayNameTierIndex)}
                        data-testid={`button-person-${p.username}`}><ShinyName displayNameColor={p.displayNameColor} displayNameTierIndex={p.displayNameTierIndex}><BadgeMark id={p.badgeId ?? null} label={p.badgeName} imageUrl={p.badgeImage} size={16} compact />{p.displayName}</ShinyName></button>}
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
      <RoomPerimeter />
      <div className="ch-in ur-in">
        {chatAccess.data?.warning && <p className="ur-moderation-notice" role="alert">{chatAccess.data.warning}</p>}
        {(chatAccess.data?.chatMuted || chatAccess.data?.reportsMuted) && (
          <p className="ur-moderation-notice" role="status">Chat is temporarily muted while a moderator reviews reports.</p>
        )}
        <RoomChannelBack roomId={roomId} />
        <div className="ur-head">
          <button type="button" ref={peopleBtn} className="bm-btn bm-btn-sm ur-people-btn" aria-haspopup="dialog" aria-expanded={drawer} onClick={() => setDrawer(true)} data-testid="button-people">People · {people.length}</button>
          <div className="ur-titlebox">
            <h1 className="ch-title ur-title" aria-label={r.room?.name ?? 'Room'} data-testid="text-university-name">
              {isComedyRoom && <span className="ur-comedy-room-icon" aria-hidden="true">🎭</span>}
              {(r.room?.name ?? 'Room').split(/\s+/).map((w, i) => (
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
          <div className={`ch-room${isSocialRoom ? ' ur-social-room' : ''}`}>
            <section className={`ur-beam${!isSocialRoom && videoBeam.beam.tv.enabled ? ' is-tv-on' : ''}${isSocialRoom ? ' is-social-room' : ''}`}
              aria-label="Nine audio-only seats">
              <div className="ur-audio-status-row">
                  <span className={`ur-audio-status ur-audio-${videoBeam.connection}`} role="status">
                  <span className="ur-status-dot" aria-hidden="true" />
                  {videoBeam.connection === 'connected' ? 'Audio ready'
                    : videoBeam.connection === 'connecting' ? 'Connecting'
                      : videoBeam.connection === 'error' ? 'Connection issue'
                        : videoBeam.beam.beamActive ? 'Joining live room' : 'Start the beam'}
                </span>
                {videoBeam.playbackBlocked && (
                  <span className="ur-room-sound-hint" role="status">Tap anywhere for sound</span>
                )}
              </div>
              {!isSocialRoom && <BeamTv ref={beamTvRef} roomName={r.room?.name ?? 'Room'}
                microphoneEnabled={ownMicEnabled}
                tv={videoBeam.beam.tv} search={videoBeam.searchTv}
                reportPlaybackFailure={videoBeam.reportTvPlaybackFailure} />}
              {!isSocialRoom && isComedyRoom && (
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
                  <div className="ur-slots" data-count={speakerCount}
                    data-tv={!isSocialRoom && videoBeam.beam.tv.enabled ? 'on' : 'off'}>
                {beamSeatLayout.map(({ slot, area, gridColumn, gridRow }) => {
                  const person = slot.participantId
                    ? people.find((p) => p.participantId === slot.participantId)
                    : undefined;
                  const mine = slot.participantId === participantId;
                  const isBeamHost = !!slot.participantId && slot.participantId === roomHostParticipantId;
                  const canSelectOpenSlot = !slot.participantId && !!sessionId && !!participantId
                    && (!videoBeam.ownSlot || videoBeam.ownSlot.slotNumber !== slot.slotNumber);
                  const moveAvailable = canSelectOpenSlot && !!videoBeam.ownSlot;
                  const joinAvailable = canSelectOpenSlot && !videoBeam.ownSlot;
                  const isSpeaking = !!slot.participantId && videoBeam.speaking.has(slot.participantId);
                  const profileTap = isSocialRoom && !!person;
                  // Non-social occupied seats: the photo is the only control (opens the quick profile);
                  // the seat area is not a button, so there are no nested interactive roles.
                  // Own mic stays on the explicit "Your beam controls" mic button.
                  const photoTrigger = !!person && !isSocialRoom && !person.botId;
                  const seatInteractive = !photoTrigger && (profileTap || mine || joinAvailable || moveAvailable);
                  const media = slot.participantId ? videoBeam.media[slot.participantId] : undefined;
                  const fallbackName = person ? (person.displayName?.trim() || person.username) : '';
                  const initials = Array.from(fallbackName).slice(0, 2).join('').toUpperCase() || '?';
                  const portrait = person ? (
                    <div className="ur-slot-portrait" aria-hidden="true">
                      {person.identity ? (
                        <span className="ur-slot-identity-fallback">
                          <IdentityAvatar identity={person.identity} name={fallbackName} size="100%" fill />
                        </span>
                      ) : (
                        <span className="ur-slot-initial-fallback">{initials}</span>
                      )}
                      {person.photoUrl && (
                        <img className="ur-slot-photo-fill" src={photoSrc(person.photoUrl)} alt=""
                          onError={event => { event.currentTarget.style.display = 'none'; }} />
                      )}
                    </div>
                  ) : null;
                  return (
                    <article className={`ur-slot${isSpeaking ? ' is-speaking' : ''}${slot.participantId ? ' is-occupied' : ''}${person ? ' has-person' : ''}${isBeamHost ? ' is-beam-host' : ''}`}
                      key={slot.slotNumber}
                      data-gifting-frame={person && giftingPerks(person.displayNameTierIndex).animatedFrame
                        ? giftingTier(normalizeGiftingLevel(person.displayNameTierIndex)).key
                        : undefined}
                      data-seat-position={area}
                      style={{ gridColumn, gridRow: area === 'host' ? '1 / span 2' : gridRow }}
                      aria-label={`Speaker slot ${slot.slotNumber}${slot.participantId ? `, ${person?.displayName ?? 'occupied'}` : ', empty'}`}>
                      <div className="ur-slot-media"
                        role={seatInteractive && !videoBeam.busy ? 'button' : undefined}
                        tabIndex={seatInteractive && !videoBeam.busy ? 0 : undefined}
                        aria-pressed={mine && !isSocialRoom ? ownMicEnabled : undefined}
                        aria-disabled={seatInteractive ? videoBeam.busy : undefined}
                        aria-label={profileTap
                          ? `View ${person?.displayName ?? 'speaker'}'s profile and cards`
                          : mine
                            ? `Your speaker spot ${slot.slotNumber}, microphone ${ownMicEnabled ? 'on' : 'off'}. Tap to toggle.`
                          : (joinAvailable || moveAvailable) && !videoBeam.busy
                            ? `${moveAvailable ? 'Move to' : 'Join'} speaker spot ${slot.slotNumber}` : undefined}
                        data-testid={mine ? `beam-seat-${slot.slotNumber}` : undefined}
                        onClick={seatInteractive && !videoBeam.busy
                          ? () => profileTap && person
                            ? openMenu(person.username, person.displayName, person.participantId, person.displayNameColor, person.displayNameTierIndex)
                            : mine
                              ? handleOwnSeatTap()
                              : void (moveAvailable ? videoBeam.moveToSlot(slot.slotNumber) : videoBeam.joinSpeaker())
                          : undefined}
                        onKeyDown={seatInteractive && !videoBeam.busy ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            if (profileTap && person)
                              openMenu(person.username, person.displayName, person.participantId, person.displayNameColor, person.displayNameTierIndex);
                            else if (mine) handleOwnSeatTap();
                            else void (moveAvailable ? videoBeam.moveToSlot(slot.slotNumber) : videoBeam.joinSpeaker());
                          }
                        } : undefined}>
                        {person && <BeamAudioTrack track={media?.audio} />}
                        {person && (slot.micMuted || slot.mutedByHost) && (
                          <span className="ur-slot-mic-icon" role="img"
                            aria-label="Microphone muted"
                            title="Microphone muted">
                            <MicOff size={13} aria-hidden="true" />
                          </span>
                        )}
                        {person && (!photoTrigger ? (
                          <div className="ur-slot-portrait-layer">{portrait}</div>
                        ) : (
                          <button type="button" className="ur-slot-avatar-button ur-slot-photo-action"
                            aria-label={`Open profile for ${person.displayName}`} aria-haspopup="dialog"
                            data-testid={`button-seat-photo-${person.username}`}
                            onClick={() => quickProfile?.open(person.username)}>
                            {portrait}
                          </button>
                        ))}
                        {person ? (
                          <div className="ur-slot-copy">
                            <span className="ur-slot-name-line">
                              <BadgeMark id={person.badgeId ?? null} label={person.badgeName} imageUrl={person.badgeImage} size={13} compact />
                              {person.self || isSocialRoom ? <ShinyName className="ur-slot-name" displayNameColor={person.displayNameColor} displayNameTierIndex={person.displayNameTierIndex}>{person.displayName}</ShinyName>
                                : <button type="button" className="ur-name ur-slot-name"
                                  aria-label={`${isSocialRoom ? 'Profile and cards for' : 'Actions for'} ${person.displayName}`}
                                  aria-haspopup={isSocialRoom ? 'dialog' : 'menu'}
                                  onClick={event => { event.stopPropagation(); openMenu(person.username, person.displayName, person.participantId, person.displayNameColor, person.displayNameTierIndex); }}>
                                  <ShinyName className="ur-seat-name-text" displayNameColor={person.displayNameColor} displayNameTierIndex={person.displayNameTierIndex}>{person.displayName}</ShinyName>
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
                            <span className="ur-slot-name ur-empty-name">{moveAvailable ? 'Move here' : joinAvailable ? 'Tap to join' : 'Open spot'}</span>
                          </div>
                        )}
                      </div>
                      {person && !mine && canModerateRoom ? (
                        <div className="ur-slot-actions">
                          <button type="button" className="ur-slot-action"
                            disabled={videoBeam.busy || slot.micMuted}
                            aria-label={`Mute ${person.displayName}'s microphone`}
                            title={`Mute ${person.displayName}'s microphone`}
                            onClick={() => void videoBeam.hostMuteMic(slot.participantId!)}>
                            <MicOff size={16} />
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
                    disabled={videoBeam.busy}
                    aria-pressed={ownMicEnabled}
                    aria-label={ownMicEnabled ? 'Mute microphone' : 'Turn microphone on'}
                    title={ownMicEnabled ? 'Mute microphone' : 'Turn microphone on'}
                    onClick={() => toggleOwnMic(!ownMicEnabled)}>
                    {ownMicEnabled ? <Mic size={16} /> : <MicOff size={16} />}
                    {ownMicEnabled ? 'Mute' : 'Unmute'}
                  </button>
                  <button type="button" className="ur-slot-action ur-slot-leave"
                    disabled={videoBeam.busy} onClick={leaveOwnSeat}
                    aria-label="Leave beam" title="Leave beam">
                    <LogOut size={16} /> Leave
                  </button>
                </div>
              )}
            </section>
            {import.meta.env.DEV && isOwnerCardTestUser && <OwnerCardGameTestMode
              roomId={roomId} variant="room" onStateChange={setOwnerCardTestState} />}
            <div className="ch-msgs" ref={box} role="log" aria-live="polite" aria-label="Room messages" tabIndex={0} onScroll={(e) => { const el = e.currentTarget; near.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} data-testid="list-messages">
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
                     <div><p><span className="ur-gift-person"><BadgeMark id={it.gift.senderBadgeId ?? null} label={it.gift.senderBadgeName} imageUrl={it.gift.senderBadgeImage} size={16} compact /><button type="button" className="ur-name" onClick={() => openMenu(it.gift.senderUsername, it.gift.senderName, undefined, it.gift.senderNameColor, it.gift.senderNameTierIndex)}><ShinyName displayNameColor={it.gift.senderNameColor} displayNameTierIndex={it.gift.senderNameTierIndex}>{it.gift.senderName}</ShinyName></button></span> sent <span className="ur-gift-person"><BadgeMark id={it.gift.recipientBadgeId ?? null} label={it.gift.recipientBadgeName} imageUrl={it.gift.recipientBadgeImage} size={16} compact /><button type="button" className="ur-name" onClick={() => openMenu(it.gift.recipientUsername, it.gift.recipientName, undefined, it.gift.recipientNameColor, it.gift.recipientNameTierIndex)}><ShinyName displayNameColor={it.gift.recipientNameColor} displayNameTierIndex={it.gift.recipientNameTierIndex}>{it.gift.recipientName}</ShinyName></button></span> a {it.gift.giftName}.</p></div>
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
                      <div><BotActivityLine botId={m.botId} name={nm} body={body} arrived /></div>
                    </div>;
                  }
                  return (
                    <div className={`ch-msg${m.botMessageType === 'chatter' ? ' ur-bot-chatter' : ''}`} key={m.id} data-testid={`bot-message-${m.id}`}>
                      <div>
                        <BotActivityLine botId={m.botId} name={nm} body={body} chatter={m.botMessageType === 'chatter'} />
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
                       {self ? <span className="ch-sender"><ShinyName displayNameColor={displayNameColor} displayNameTierIndex={displayNameTierIndex}>{badge}{nm}</ShinyName></span>
                          : <span className="ch-sender"><button type="button" className="ur-name" aria-haspopup="menu" aria-label={`Actions for ${nm}`} onClick={() => openMenu(m.username, nm, m.authorId, displayNameColor, displayNameTierIndex)}><ShinyName displayNameColor={displayNameColor} displayNameTierIndex={displayNameTierIndex}>{badge}{nm}</ShinyName></button></span>}
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
            <form className={`ch-comp dw-room-composer${whispering ? ' ur-wmode' : ''}`} onSubmit={(e) => { e.preventDefault(); if (whispering) doWhisper(); else doSend(text); }}>
              <input type="text" value={text} maxLength={limit} onChange={(e) => setText(e.target.value)} placeholder={whispering ? 'Whisper (1-1000)' : 'Say something (1-280)'} aria-label={whispering ? 'Whisper' : 'Message'} data-testid="input-message" />
              <button type="submit" className="bm-btn bm-btn-primary" disabled={(whispering ? whisperMut.isPending : pending) || !text.trim()} data-testid="button-send">
                <Send size={16} aria-hidden="true" /><span>{whispering ? (whisperMut.isPending ? 'Sending...' : 'Whisper') : pending ? 'Sending...' : 'Send'}</span>
              </button>
            </form>
          </div>
        </div>
      </div>

      {menu && (
        <div className={`ur-modal${isSocialRoom ? ' ur-social-profile-scrim' : ''}`} onClick={() => setMenu(null)}>
          <div ref={menuBox} className={`ur-menu${isSocialRoom ? ' ur-social-profile-popup' : ''}`}
            role={isSocialRoom ? 'dialog' : 'menu'} aria-modal={isSocialRoom || undefined}
            aria-label={isSocialRoom ? `Profile and cards for ${menu.username}` : `Actions for ${menu.displayName}`}
            aria-labelledby={isSocialRoom ? 'ur-profile-popup-title' : undefined}
            onClick={(e) => e.stopPropagation()}>
            {isSocialRoom && (
              <>
                <header className="ur-profile-popup-head">
                  <UserPhoto username={menu.username} displayName={menu.displayName} photoUrl={menu.photoUrl} size={40} />
                  <div>
                    <strong id="ur-profile-popup-title"><ShinyName displayNameColor={menu.displayNameColor} displayNameTierIndex={menu.displayNameTierIndex}>{menu.displayName}</ShinyName></strong>
                    <span>@{menu.username}</span>
                  </div>
                  <button type="button" className="ur-profile-popup-x" aria-label="Close profile" data-testid="button-close-profile" onClick={() => setMenu(null)}>×</button>
                </header>
                <section className="ur-profile-popup-cards" aria-live="polite">
                  <strong>Cards this round</strong>
                  {profileHandLoading ? <p role="status">Checking this round…</p>
                    : profileHandError ? <p role="status">Cards aren’t available right now.</p>
                      : profileHandCards.length
                        ? <CardHandFan cards={profileHandCards} expanded
                          premium={isSocialRoom && canUsePremiumCardFinish(import.meta.env.DEV, chatAccess.data)} />
                        : <p>No cards in this round.</p>}
                </section>
              </>
            )}
            {!isSocialRoom && <strong><ShinyName displayNameColor={menu.displayNameColor} displayNameTierIndex={menu.displayNameTierIndex}>{menu.displayName}</ShinyName></strong>}
            {!menuIsSelf && (
              <>
                <button type="button" role={isSocialRoom ? undefined : 'menuitem'} onClick={() => { setGiftBag({ recipient: menu }); setMenu(null); setDrawer(false); }}>Gift</button>
                <button type="button" role={isSocialRoom ? undefined : 'menuitem'} onClick={() => { const u = menu.username; setMenu(null); nav(`/community/messages/${encodeURIComponent(u)}`); }}>Message</button>
                <button type="button" role={isSocialRoom ? undefined : 'menuitem'} onClick={() => {
                  setReporting({ targetType: 'user', targetUsername: menu.username, roomId });
                  setMenu(null); setDrawer(false);
                }}>Report user</button>
                <button type="button" role={isSocialRoom ? undefined : 'menuitem'} disabled={block.isPending} onClick={() => {
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
                {canModerateRoom && menu.participantId && !menu.botId && menu.participantId !== me?.participantId && (
                  <button type="button" role={isSocialRoom ? undefined : 'menuitem'} disabled={videoBeam.busy} onClick={() => {
                    const targetParticipantId = menu.participantId!;
                    setMenu(null);
                    void videoBeam.kick(targetParticipantId);
                  }}>Remove from this room</button>
                )}
                <button type="button" role={isSocialRoom ? undefined : 'menuitem'} autoFocus onClick={() => { setWhisperTo(menu); setMenu(null); setDrawer(false); setText(''); setSendErr(null); }}>Whisper</button>
                <button type="button" role={isSocialRoom ? undefined : 'menuitem'} onClick={() => { const u = menu.username; setMenu(null); nav(`/community/people/${encodeURIComponent(u)}`); }}>View profile</button>
                <button type="button" role={isSocialRoom ? undefined : 'menuitem'} disabled={ignoreMut.isPending} onClick={() => toggleIgnore(menu)}>{ignored.has(menu.username) ? 'Unignore' : 'Ignore'}</button>
              </>
            )}
            <button type="button" role={isSocialRoom ? undefined : 'menuitem'} onClick={() => setMenu(null)}>{menuIsSelf ? 'Close' : 'Cancel'}</button>
          </div>
        </div>
      )}

      {giftBag && <GiftBag recipient={giftBag.recipient} recipients={giftRecipients} roomId={roomId} sessionId={sessionId} onClose={() => setGiftBag(null)} />}
      {gifts.animation && <GiftComboPlayer
        key={gifts.animation.id}
        gift={gifts.animation}
        waitingCount={gifts.waitingCount}
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
      <RoomCoinDropOverlay event={coinDropQueue[0] ?? null} onFinish={finishCoinDrop} />
      <GiftingEntranceOverlay arrival={giftingArrivals[0] ?? null} onFinish={finishGiftingArrival} />
      {r.streakReward && (
        <div className="ur-streak-reward-toast" role="status">
          Seven-day room streak! +{r.streakReward.coins} coins
        </div>
      )}
    </div>
  );
}
