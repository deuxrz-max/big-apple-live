import {
  createAccountRoom, joinAccountRoom, getRoom, getMyProfile, saveMyProfile,
  getRoomMessages, sendRoomMessage, heartbeatParticipant, leaveRoom,
  controlRoomMicrophone,
  type AccountProfile, type EmojiIdentity, type RoomState, type RoomSession,
  type ChatMessage, type ChatAccepted,
} from '@workspace/api-client-react';
import { loadCreds, saveCreds, clearCreds } from '@/lib/room-creds';
import { getPortrait, isPortraitId, portraitIdentity } from '../portraits';
import { isMoodKey } from '../moodCatalog';
import { BeamError, CAPACITY, isBeamCapacity, type BeamState, type BeamRoom, type Identity, type BeamCapacity } from '../types';

/** Only the old isolated save is browser-local. Shared state always comes from API. */
export const STORAGE_KEY = 'webuggin.beam.demo.v1';
let state: BeamState = { version: 1, rooms: {}, session: null };
let userId: string | null = null;
let profile: AccountProfile | null = null;
let notice: string | null = null;
let stopLive: (() => void) | undefined;
let generation = 0;
const listeners = new Set<() => void>();
const profileVersions = new Map<string, number>();
function notify() { listeners.forEach(l => l()); }
function commit(next: BeamState) { state = next; notify(); }
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const getState = () => state;
export const getProfileSnapshot = () => profile;
export const getPersistenceNotice = () => notice;
export const normalizeCode = (c: string) => c.toUpperCase().replace(/[\s-]/g, '');
export const isValidCode = (c: string) => /^([A-Z0-9]{6}|[A-F0-9]{12})$/.test(normalizeCode(c));
export const validateHandle = (h: string) => /^[A-Za-z0-9_]{3,24}$/.test(h.trim())
  ? null : 'Dedicated name is 3–24 characters: letters, numbers, or underscores.';

export function configureBeamAccount(id: string | null) {
  if (id === userId) return;
  stopLive?.();
  generation++;
  userId = id;
  profile = null;
  profileVersions.clear();
  notice = null;
  commit({ version: 1, rooms: {}, session: null });
}
function requireUser() {
  if (!userId) throw new Error('Sign in to join a beam.');
  return userId;
}
function creds(code: string, selfId?: string) {
  const c = loadCreds(requireUser(), code);
  if (!c || (selfId && selfId !== c.participantId)) throw new BeamError('NOT_MEMBER', 'Join this beam first.');
  return c;
}
function headers(code: string, selfId?: string) {
  return { 'X-Room-Session': creds(code, selfId).participantSessionId };
}
export function beamIdentity(identity: EmojiIdentity): Identity {
  const fallback = portraitIdentity(identity.gender === 'Male' ? 'spiked-smile' : 'ponytail-smile');
  const portrait = isPortraitId(identity.portraitId) ? getPortrait({ ...fallback, portraitId: identity.portraitId }) : getPortrait(fallback);
  return {
    portraitId: portrait.id, emoji: portrait.emoji,
    style: identity.gender === 'Male' ? 'spiked' : 'ponytails', hairColor: identity.hairColor,
    ...(isMoodKey(identity.currentMood) ? { currentMood: identity.currentMood } : {}),
  };
}
function snapshot(r: RoomState): BeamRoom {
  return {
    code: r.roomId, name: r.name, capacity: isBeamCapacity(r.capacity) ? r.capacity : CAPACITY,
    hostParticipantId: r.hostParticipantId,
    createdAt: new Date(r.createdAt).getTime(),
    participants: r.participants.map(p => ({
      id: p.participantId, handle: p.displayName, joinedAt: new Date(p.joinedAt).getTime(),
      displayNameColor: p.displayNameColor ?? '#FFFFFF',
      simulated: false,
      micEnabled: p.micEnabled, hostMuted: p.hostMuted, unmuteRequested: p.unmuteRequested,
      identity: p.identity ? beamIdentity(p.identity) : portraitIdentity('ponytail-smile'),
    })),
    messages: state.rooms[r.roomId]?.messages ?? [],
  };
}

/** Private capability stays outside public Beam snapshots. */
export function getBeamAudioCredentials(code: string, selfId: string) {
  return { ...creds(code, selfId) };
}

export async function controlBeamMicrophone(code: string, selfId: string, targetId: string, action: 'mute' | 'unmute' | 'request-unmute') {
  const credential = creds(code, selfId);
  const epoch = generation;
  const room = await controlRoomMicrophone(code, targetId, { action }, {
    headers: { Authorization: `Bearer ${credential.participantSessionId}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (epoch !== generation) throw new Error('Account changed. Try again.');
  applySnapshot(room);
}
function applySnapshot(r: RoomState) {
  // Voice-only legacy rooms still retain their own 100-person capacity.
  if (!isBeamCapacity(r.capacity)) throw new Error('This is a voice room. Open it from your account portal.');
  const own = state.session?.code === r.roomId
    ? r.participants.find(p => p.participantId === state.session?.selfId) : undefined;
  if (profile && own?.identity) profile = { ...profile, username: own.displayName, identity: own.identity };
  commit({ ...state, rooms: { ...state.rooms, [r.roomId]: snapshot(r) } });
}
function message(m: ChatMessage) {
  return {
    id: m.id, kind: m.kind, authorId: m.authorId,
    authorSnapshot: { handle: m.username, identity: beamIdentity(m.identity), displayNameColor: m.displayNameColor ?? '#FFFFFF' },
    text: m.text, ts: new Date(m.createdAt).getTime(),
  };
}
function applyMessages(code: string, incoming: ChatMessage[]) {
  const room = state.rooms[code];
  if (!room) return;
  const merged = new Map(room.messages.map(m => [m.id, m]));
  incoming.forEach(m => merged.set(m.id, message(m)));
  const messages = [...merged.values()].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id)).slice(-60);
  commit({ ...state, rooms: { ...state.rooms, [code]: { ...room, messages } } });
}
function applyAccepted(code: string, accepted: ChatAccepted) {
  const room = state.rooms[code];
  if (!room) return;
  const version = new Date(accepted.profile.updatedAt).getTime();
  if (version >= (profileVersions.get(accepted.profile.username) ?? 0)) {
    profileVersions.set(accepted.profile.username, version);
    if (accepted.message.authorId === state.session?.selfId) profile = accepted.profile;
    commit({ ...state, rooms: { ...state.rooms, [code]: {
      ...room, participants: room.participants.map(p => p.id === accepted.message.authorId
        ? { ...p, identity: beamIdentity(accepted.profile.identity) } : p),
    } } });
  }
  applyMessages(code, [accepted.message]);
}
export async function loadAccountProfile() {
  requireUser();
  const epoch = generation;
  const result = await getMyProfile();
  if (epoch !== generation) throw new Error('Account changed. Try again.');
  profile = result.profile;
  return profile;
}
/** Explicit selection only. Entering a room never resets an existing mood. */
async function selectIdentity(handle: string, identity: Identity) {
  const id = requireUser();
  const epoch = generation;
  const current = await loadAccountProfile();
  if (id !== userId || epoch !== generation) throw new Error('Account changed. Try again.');
  const portrait = getPortrait(identity);
  const emojiId = [...portrait.emoji].map(c => c.codePointAt(0)!.toString(16).toUpperCase()).join('-');
  const saved = await saveMyProfile({
    username: current?.username ?? handle.trim(),
    identity: {
      emojiId, gender: portrait.style === 'spiked' ? 'Male' : 'Female',
      color: current?.identity.color ?? '#F7C531', hairColor: identity.hairColor,
      portraitId: portrait.id,
      ...(identity.currentMood ? { currentMood: identity.currentMood } : {}),
    },
  });
  if (id !== userId || epoch !== generation) throw new Error('Account changed. Try again.');
  profile = saved;
  profileVersions.set(saved.username, new Date(saved.updatedAt).getTime());
  notify();
  return saved;
}
export function legacyIdentity(): Identity | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as BeamState | null;
    const p = saved?.session && saved.rooms?.[saved.session.code]?.participants.find(p => p.id === saved.session!.selfId);
    if (p && isPortraitId(p.identity.portraitId)) return p.identity;
  } catch { /* Old saves are optional and never become shared room history. */ }
  return undefined;
}
export async function checkJoinable(raw: string) {
  const epoch = generation;
  const code = normalizeCode(raw);
  if (!isValidCode(code)) throw new BeamError('INVALID_CODE', 'Enter a six-character Beam code.');
  const room = await getRoom(code);
  if (epoch !== generation) throw new Error('Account changed. Try again.');
  const alreadyHere = room.participants.some(p => p.isRegistered && p.displayName === profile?.username);
  if (room.participants.length >= room.capacity && !alreadyHere) {
    throw new BeamError('ROOM_FULL', `This beam is full (${room.capacity}/${room.capacity}).`);
  }
  applySnapshot(room);
  return state.rooms[code];
}
async function enter(session: RoomSession, owner: string) {
  if (owner !== userId) throw new Error('Account changed. Try again.');
  const epoch = generation;
  const previous = state.session;
  if (previous && previous.code !== session.room.roomId) {
    await leaveBeam(previous.code, previous.selfId);
  }
  if (owner !== userId || epoch !== generation) throw new Error('Account changed. Try again.');
  saveCreds(owner, session.room.roomId, session);
  if (previous?.code !== session.room.roomId || previous.selfId !== session.participantId) {
    const cached = state.rooms[session.room.roomId];
    if (cached) commit({ ...state, rooms: { ...state.rooms, [cached.code]: { ...cached, messages: [] } } });
  }
  applySnapshot(session.room);
  commit({ ...state, session: { code: session.room.roomId, selfId: session.participantId } });
  startLive(session.room.roomId);
  return session.room.roomId;
}
export async function createBeam(name: string, handle: string, identity: Identity, capacity: BeamCapacity = CAPACITY) {
  const owner = requireUser();
  const epoch = generation;
  if (!await loadAccountProfile()) await selectIdentity(handle, identity);
  if (owner !== userId || epoch !== generation) throw new Error('Account changed. Try again.');
  return enter(await createAccountRoom({ name: name.trim(), capacity }), owner);
}
export async function joinBeam(raw: string, handle: string, identity: Identity) {
  const owner = requireUser();
  const epoch = generation;
  if (!await loadAccountProfile()) await selectIdentity(handle, identity);
  if (owner !== userId || epoch !== generation) throw new Error('Account changed. Try again.');
  return enter(await joinAccountRoom(normalizeCode(raw)), owner);
}
export async function restoreBeam(raw: string) {
  const code = normalizeCode(raw);
  const owner = requireUser();
  const epoch = generation;
  const c = loadCreds(owner, code);
  const r = await getRoom(code);
  if (epoch !== generation) return;
  applySnapshot(r);
  if (!c) return;
  // Account-checked history prevents using a saved capability for a different user.
  try {
    const messages = await getRoomMessages(code, { headers: headers(code) });
    if (epoch !== generation) return;
    await heartbeatParticipant(code, c.participantSessionId);
    if (epoch !== generation) return;
    commit({ ...state, session: { code, selfId: c.participantId } });
    applyMessages(code, messages);
    startLive(code);
  } catch (error) {
    clearCreds(owner, code);
    throw error;
  }
}
export async function leaveBeam(code: string, selfId: string) {
  const owner = requireUser();
  const epoch = generation;
  const c = creds(code, selfId);
  await leaveRoom(code, c.participantSessionId);
  clearCreds(owner, code);
  if (epoch !== generation) return;
  stopLive?.();
  notice = null;
  commit({ ...state, session: null });
}
export async function updateIdentity(code: string, selfId: string, handle: string, identity: Identity) {
  const epoch = generation;
  creds(code, selfId);
  const saved = await selectIdentity(handle, identity);
  if (epoch !== generation) return;
  const room = state.rooms[code];
  commit({ ...state, rooms: { ...state.rooms, [code]: {
    ...room, participants: room.participants.map(p => p.id === selfId
      ? { ...p, handle: saved.username, identity: beamIdentity(saved.identity) } : p),
  } } });
}
export async function sendMessage(code: string, selfId: string, kind: 'text' | 'reaction', raw: string) {
  const epoch = generation;
  const accepted = await sendRoomMessage(code, { text: raw.trim(), kind }, { headers: headers(code, selfId) });
  if (epoch === generation) applyAccepted(code, accepted);
}
/** Fetch-stream SSE supports the private room header, reconnect, and rehydration. */
function startLive(code: string) {
  stopLive?.();
  const epoch = generation;
  const controller = new AbortController();
  let retry: ReturnType<typeof setTimeout> | undefined;
  let heartbeatBusy = false;
  const active = () => !controller.signal.aborted && epoch === generation;
  const report = (error: unknown) => {
    if (!active()) return;
    notice = error instanceof Error ? error.message : 'Room connection lost. Retrying.';
    commit({ ...state });
  };
  const heartbeat = setInterval(async () => {
    if (heartbeatBusy || !active()) return;
    heartbeatBusy = true;
    try {
      await heartbeatParticipant(code, creds(code).participantSessionId);
    } catch (e) {
      report(e);
      if ([401, 404].includes((e as { status?: number }).status ?? 0) && active()) {
        const owner = requireUser();
        clearCreds(owner, code);
        stopLive?.();
        commit({ ...state, session: null });
      }
    }
    finally { heartbeatBusy = false; }
  }, 25_000);
  async function stream() {
    try {
      const res = await fetch(`/api/account/rooms/${code}/events`, {
        headers: headers(code), credentials: 'same-origin', signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error('Room connection unavailable. Rejoin if your membership expired.');
      // Subscribe first, then history: ID merge closes the reconnect race.
      const history = await getRoomMessages(code, { headers: headers(code), signal: controller.signal });
      if (!active()) return;
      applyMessages(code, history);
      notice = null;
      commit({ ...state });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (active()) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = frame.match(/^event: (.+)$/m)?.[1];
          const data = frame.match(/^data: (.+)$/m)?.[1];
          if (!data || !active()) continue;
          if (event === 'room.snapshot') applySnapshot(JSON.parse(data));
          if (event === 'chat.accepted') applyAccepted(code, JSON.parse(data));
        }
      }
      if (active()) throw new Error('Room disconnected. Reconnecting…');
    } catch (e) {
      report(e);
      if (active()) retry = setTimeout(stream, 2000);
    }
  }
  stopLive = () => { controller.abort(); clearInterval(heartbeat); if (retry) clearTimeout(retry); };
  void stream();
}