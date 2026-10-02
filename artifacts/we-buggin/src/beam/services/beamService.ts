import {
  BeamError,
  CAPACITY,
  MAX_MESSAGES,
  type BeamMessage,
  type BeamRoom,
  type BeamState,
  type Identity,
  type MessageKind,
  type Participant,
} from '../types';
import { isPortraitId } from '../portraits';

/**
 * FRONTEND DEMO / SIMULATED PARTICIPANTS.
 * Local mock adapter. No network. Persisted under an isolated localStorage key.
 * A real backend replaces the exported functions in this file (see ../README.md).
 */
export const STORAGE_KEY = 'webuggin.beam.demo.v1';
export const DEMO_ROOM_CODE = 'LATEBG';
export const FULL_ROOM_CODE = 'FULL12';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HANDLE_RE = /^[A-Za-z0-9_.-]{2,12}$/;
const id = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`;

const PEERS: Array<[string, string, Identity['style'], string]> = [
  ['moth', '🦋', 'none', '#111111'],
  ['k.ito', '🥷', 'spiked', '#1d3cff'],
  ['vex', '👾', 'none', '#111111'],
  ['nine', '🪩', 'ponytails', '#111111'],
  ['sol', '🌙', 'none', '#111111'],
  ['dre', '🐺', 'spiked', '#111111'],
  ['ash', '🧊', 'none', '#111111'],
  ['juno', '🪐', 'ponytails', '#1d3cff'],
  ['rook', '🦉', 'none', '#111111'],
  ['pike', '🗿', 'none', '#111111'],
  ['bao', '🍒', 'ponytails', '#111111'],
  ['tess', '⚡', 'spiked', '#111111'],
];

function peer(i: number, now: number): Participant {
  const [handle, emoji, style, hairColor] = PEERS[i];
  return { id: `seed_${handle}`, handle, identity: { emoji, style, hairColor }, simulated: true, joinedAt: now - (60 - i) * 60000 };
}

function msg(p: Participant, kind: MessageKind, text: string, ts: number): BeamMessage {
  return { id: id('m'), kind, authorId: p.id, authorSnapshot: { handle: p.handle, identity: p.identity }, text, ts };
}

function seed(): BeamState {
  const now = Date.now();
  const late = Array.from({ length: 6 }, (_, i) => peer(i, now));
  const [moth, kito, vex, nine, sol, dre] = late;
  const lateRoom: BeamRoom = {
    code: DEMO_ROOM_CODE,
    name: 'Late Night Buggin',
    capacity: CAPACITY,
    createdAt: now - 3600000,
    participants: late,
    messages: [
      msg(moth, 'text', 'ok who is still up', now - 540000),
      msg(kito, 'text', 'always', now - 500000),
      msg(vex, 'text', 'drop is at 2. nobody say the name yet', now - 420000),
      msg(nine, 'reaction', '👀', now - 400000),
      msg(sol, 'text', 'tell them to make the tee boxier', now - 300000),
      msg(dre, 'text', 'boxier or nothing', now - 240000),
      msg(kito, 'reaction', '🔥', now - 200000),
      msg(moth, 'text', 'room is open, seats left', now - 120000),
    ],
  };
  const full = Array.from({ length: CAPACITY }, (_, i) => peer(i, now));
  const fullRoom: BeamRoom = {
    code: FULL_ROOM_CODE,
    name: 'Full House',
    capacity: CAPACITY,
    createdAt: now - 7200000,
    participants: full,
    messages: [msg(full[0], 'text', 'twelve of us. door is shut.', now - 90000)],
  };
  return { version: 1, rooms: { [lateRoom.code]: lateRoom, [fullRoom.code]: fullRoom }, session: null };
}

function validIdentity(i: Identity | undefined): boolean {
  return !!i && typeof i.emoji === 'string' && i.emoji.length > 0 && i.emoji.length <= 16
    && ['none', 'spiked', 'ponytails'].includes(i.style) && /^#[0-9a-f]{6}$/i.test(i.hairColor)
    && (i.portraitId === undefined || isPortraitId(i.portraitId));
}

function valid(s: unknown): s is BeamState {
  const x = s as BeamState;
  if (!x || x.version !== 1 || typeof x.rooms !== 'object' || x.rooms === null) return false;
  const roomsValid = Object.entries(x.rooms).every(([code, r]) =>
    r && /^[A-Z0-9]{6}$/.test(code) && r.code === code && typeof r.name === 'string'
      && r.capacity === CAPACITY && Array.isArray(r.participants) && r.participants.length <= CAPACITY
      && r.participants.every(p => p && typeof p.id === 'string' && typeof p.handle === 'string'
        && typeof p.simulated === 'boolean' && validIdentity(p.identity))
      && Array.isArray(r.messages) && r.messages.length <= MAX_MESSAGES
      && r.messages.every(m => m && typeof m.id === 'string' && typeof m.text === 'string'
        && ['text', 'reaction', 'system'].includes(m.kind) && Number.isFinite(m.ts)
        && (m.authorId === null || typeof m.authorId === 'string')
        && (m.authorSnapshot === null || (typeof m.authorSnapshot?.handle === 'string' && validIdentity(m.authorSnapshot.identity)))));
  return roomsValid && (x.session === null || (!!x.session && typeof x.session.code === 'string'
    && typeof x.session.selfId === 'string' && !!x.rooms[x.session.code]?.participants.some(p => p.id === x.session!.selfId)));
}

let persistenceNotice: string | null = null;

function load(): BeamState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (valid(parsed)) return parsed;
      persistenceNotice = 'Saved demo data was invalid. A fresh demo has been loaded.';
    }
  } catch {
    persistenceNotice = 'Demo storage could not be read. Changes may not survive a refresh.';
  }
  return seed();
}

let state: BeamState = load();
const listeners = new Set<() => void>();

function commit(next: BeamState) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    persistenceNotice = null;
  } catch {
    persistenceNotice = 'Browser storage is unavailable. This demo works in memory; changes will be lost on refresh.';
  }
  listeners.forEach((l) => l());
}

export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getState = () => state;
export const getPersistenceNotice = () => persistenceNotice;

export const normalizeCode = (c: string) => c.toUpperCase().replace(/[\s-]/g, '');
export const isValidCode = (c: string) => /^[A-Z0-9]{6}$/.test(normalizeCode(c));

export function validateHandle(h: string): string | null {
  return HANDLE_RE.test(h.trim()) ? null : 'Handle is 2 to 12 characters: letters, numbers, . _ -';
}

function patchRoom(room: BeamRoom, extra?: Partial<BeamState>) {
  commit({ ...state, rooms: { ...state.rooms, [room.code]: room }, ...extra });
}

const trim = (m: BeamMessage[]) => m.slice(-MAX_MESSAGES);

function sys(text: string): BeamMessage {
  return { id: id('m'), kind: 'system', authorId: null, authorSnapshot: null, text, ts: Date.now() };
}

/** Throws a BeamError if the room cannot currently be joined. */
export function checkJoinable(rawCode: string): BeamRoom {
  const code = normalizeCode(rawCode);
  if (!isValidCode(code)) throw new BeamError('INVALID_CODE', 'Codes are 6 characters, letters and numbers.');
  const room = state.rooms[code];
  if (!room) throw new BeamError('NOT_FOUND', `No beam found for ${code}. Check the code and try again.`);
  const alreadyHere = state.session?.code === code && room.participants.some(p => p.id === state.session?.selfId);
  if (!alreadyHere && room.participants.length >= CAPACITY) throw new BeamError('ROOM_FULL', `${room.name} is full (${CAPACITY}/${CAPACITY}). Try again when someone leaves.`);
  return room;
}

function enter(room: BeamRoom, handle: string, identity: Identity): string {
  const h = handle.trim();
  const err = validateHandle(h);
  if (err) throw new BeamError('INVALID_HANDLE', err);
  const existing = state.session?.code === room.code
    ? room.participants.find(p => p.id === state.session?.selfId) : undefined;
  if (room.participants.some((p) => p.id !== existing?.id && p.handle.toLowerCase() === h.toLowerCase())) throw new BeamError('HANDLE_TAKEN', `${h} is already in this beam.`);
  if (existing) {
    updateIdentity(room.code, existing.id, h, identity);
    return room.code;
  }
  if (room.participants.length >= CAPACITY) throw new BeamError('ROOM_FULL', 'This beam just filled up.');
  const self: Participant = { id: id('me'), handle: h, identity, simulated: false, joinedAt: Date.now() };
  const rooms = { ...state.rooms };
  const previous = state.session && rooms[state.session.code];
  if (previous && state.session) {
    const previousSelfId = state.session.selfId;
    const previousSelf = previous.participants.find(p => p.id === previousSelfId);
    rooms[previous.code] = { ...previous,
      participants: previous.participants.filter(p => p.id !== previousSelfId),
      messages: previousSelf ? trim([...previous.messages, sys(`${previousSelf.handle} left`)]) : previous.messages,
    };
  }
  rooms[room.code] = { ...room, participants: [...room.participants, self], messages: trim([...room.messages, sys(`${h} joined`)]) };
  commit({ ...state, rooms, session: { code: room.code, selfId: self.id } });
  return room.code;
}

export function createBeam(name: string, handle: string, identity: Identity): string {
  const n = name.trim();
  if (n.length < 2 || n.length > 32) throw new BeamError('INVALID_NAME', 'Name your beam with 2 to 32 characters.');
  let code = '';
  do {
    code = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (state.rooms[code]);
  const room: BeamRoom = { code, name: n, capacity: CAPACITY, participants: [], messages: [], createdAt: Date.now() };
  return enter(room, handle, identity);
}

export function joinBeam(rawCode: string, handle: string, identity: Identity): string {
  return enter(checkJoinable(rawCode), handle, identity);
}

function mustBeMember(code: string, selfId: string) {
  const room = state.rooms[code];
  if (!room) throw new BeamError('NOT_FOUND', 'Beam not found.');
  const me = room.participants.find((p) => p.id === selfId);
  if (!me) throw new BeamError('NOT_MEMBER', 'You are not in this beam.');
  return { room, me };
}

export function leaveBeam(code: string, selfId: string) {
  const room = state.rooms[code];
  if (room) {
    const me = room.participants.find((p) => p.id === selfId);
    patchRoom(
      {
        ...room,
        participants: room.participants.filter((p) => p.id !== selfId),
        messages: me ? trim([...room.messages, sys(`${me.handle} left`)]) : room.messages,
      },
      { session: null },
    );
  } else commit({ ...state, session: null });
}

export function updateIdentity(code: string, selfId: string, handle: string, identity: Identity) {
  const { room, me } = mustBeMember(code, selfId);
  const h = handle.trim();
  const err = validateHandle(h);
  if (err) throw new BeamError('INVALID_HANDLE', err);
  if (room.participants.some((p) => p.id !== selfId && p.handle.toLowerCase() === h.toLowerCase())) throw new BeamError('HANDLE_TAKEN', `${h} is already in this beam.`);
  patchRoom({ ...room, participants: room.participants.map((p) => (p.id === me.id ? { ...p, handle: h, identity } : p)) });
}

export function sendMessage(code: string, selfId: string, kind: 'text' | 'reaction', raw: string) {
  const { room, me } = mustBeMember(code, selfId);
  const text = raw.trim();
  if (!text) throw new BeamError('EMPTY_MESSAGE', 'Write something first.');
  if (text.length > 280) throw new BeamError('TOO_LONG', 'Keep it under 280 characters.');
  patchRoom({ ...room, messages: trim([...room.messages, msg(me, kind, text, Date.now())]) });
}

/* ---- Clearly labeled simulation controls (user-triggered only) ---- */

export function simulateAddPeer(code: string) {
  const room = state.rooms[code];
  if (!room) throw new BeamError('NOT_FOUND', 'Beam not found.');
  if (room.participants.length >= room.capacity) throw new BeamError('ROOM_FULL', 'Beam is full (12/12).');
  const used = new Set(room.participants.map((p) => p.handle));
  const idx = PEERS.findIndex(([h]) => !used.has(h));
  const [handle, emoji, style, hairColor] = idx >= 0 ? PEERS[idx] : [`sim${room.participants.length + 1}`, '🤖', 'none' as const, '#111111'];
  const p: Participant = { id: id('sim'), handle, identity: { emoji, style, hairColor }, simulated: true, joinedAt: Date.now() };
  patchRoom({ ...room, participants: [...room.participants, p], messages: trim([...room.messages, sys(`${handle} joined (simulated)`)]) });
}

export function simulateRemovePeer(code: string) {
  const room = state.rooms[code];
  if (!room) return;
  const p = [...room.participants].reverse().find((x) => x.simulated);
  if (!p) return;
  patchRoom({
    ...room,
    participants: room.participants.filter((x) => x.id !== p.id),
    messages: trim([...room.messages, sys(`${p.handle} left (simulated)`)]),
  });
}

export function simulateFill(code: string) {
  let guard = CAPACITY;
  while (guard-- > 0 && (state.rooms[code]?.participants.length ?? CAPACITY) < CAPACITY) simulateAddPeer(code);
}

export function resetDemo() {
  commit(seed());
}
