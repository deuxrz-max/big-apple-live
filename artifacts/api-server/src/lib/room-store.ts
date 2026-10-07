import { randomBytes, randomUUID } from "node:crypto";
import type { Participant, RoomSession, RoomState, EmojiIdentity, ChatAccepted, AccountRoomInput } from "@workspace/api-zod";
import { ENABLE_ROOM_MOOD_VISUALS, type EmojiParticleEvent, type RoomMoodUpdate } from "@workspace/beam-identity";
import { RoomMoodTracker } from "./room-mood";
import { CommunityAtmosphereTracker } from "./community-atmosphere";

export const SESSION_TIMEOUT_MS = 90_000;
export const EMPTY_ROOM_TIMEOUT_MS = 60 * 60 * 1000;

export class RoomError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

type RoomEvent =
  | { type: "emoji_particle"; data: EmojiParticleEvent }
  | { type: "room_mood_update"; data: RoomMoodUpdate }
  | { type: "chat.accepted"; data: ChatAccepted; senderAccountId?: string }
  | { type: "chat.refresh"; data: { roomId: string } }
  | { type: "room.snapshot"; data: RoomState }
  | { type: "room.expired"; data: { roomId: string } };
type Listener = (event: RoomEvent) => void;
type ActiveSession = { participant: Participant; lastSeenAt: number; accountId?: string };
type AccountIdentity = { accountId: string; identity: EmojiIdentity; photoUrl?: string | null };
function copyParticipant(participant: Participant): Participant {
  return {
    ...participant, joinedAt: new Date(participant.joinedAt),
    identity: participant.identity ? { ...participant.identity } : null,
  };
}
type Room = {
  roomId: string;
  historyId: string;
  name: string;
  capacity: number;
  createdAt: Date;
  hostParticipantId: string;
  hostAccountId?: string;
  sessions: Map<string, ActiveSession>;
  listeners: Set<Listener>;
  emptySince: number | null;
  mood: RoomMoodTracker;
  community?: CommunityAtmosphereTracker;
};

/** Single-process, ephemeral presence store. Session credentials are never in snapshots. */
export class RoomStore {
  private readonly rooms = new Map<string, Room>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly allocateCode: (short: boolean) => string = short => randomBytes(short ? 3 : 6).toString("hex").toUpperCase(),
  ) {}

  registerCommunity(input: { roomId: string; historyId: string; label: string; createdAt: Date;
    atmosphere: { scene: "city" | "calm" | "volcano"; since: number } | null }) {
    if (this.rooms.has(input.roomId)) return;
    this.rooms.set(input.roomId, { roomId: input.roomId, historyId: input.historyId,
      name: input.label, capacity: 0, createdAt: input.createdAt, hostParticipantId: randomUUID(),
      sessions: new Map(), listeners: new Set(), emptySince: null, mood: new RoomMoodTracker(this.now),
      community: new CommunityAtmosphereTracker(this.now, undefined, input.atmosphere) });
  }
  isCommunity(roomId: string) { return !!this.rooms.get(roomId.toUpperCase())?.community; }
  communityAtmosphere(roomId: string) { return this.requireRoom(roomId).community; }
  refreshChatVisibility() {
    for (const room of this.rooms.values()) if (room.community)
      this.emit(room, { type: "chat.refresh", data: { roomId: room.roomId } });
  }
  publishCommunityAtmosphere(roomId: string) { this.broadcast(this.requireRoom(roomId)); }

  create(displayName: string, account?: AccountIdentity, beam?: AccountRoomInput): RoomSession {
    this.sweep();
    if (this.rooms.size >= 10_000) {
      throw new RoomError(503, "University service capacity reached");
    }
    let roomId: string;
    do {
      roomId = this.allocateCode(!!beam);
    } while (this.rooms.has(roomId));
    const room: Room = {
      roomId,
      historyId: randomUUID(),
      name: beam?.name ?? "Room",
      capacity: beam?.capacity ?? 100,
      createdAt: new Date(this.now()),
      hostParticipantId: "",
      hostAccountId: account?.accountId,
      sessions: new Map(),
      listeners: new Set(),
      emptySince: null,
      mood: new RoomMoodTracker(this.now),
    };
    this.rooms.set(roomId, room);
    return this.addSession(room, displayName, account);
  }

  join(roomId: string, displayName: string, account?: AccountIdentity): RoomSession {
    const room = this.requireRoom(roomId);
    // Rejoining the same account restores its membership instead of taking a
    // second seat. This does not extend another account's lease.
    if (account) {
      for (const [participantSessionId, session] of room.sessions) {
        if (session.accountId !== account.accountId) continue;
        session.lastSeenAt = this.now();
        return { participantSessionId, participantId: session.participant.participantId, room: this.snapshot(room) };
      }
    }
    if (room.capacity > 0 && room.sessions.size >= room.capacity) {
      throw new RoomError(409, "University participant capacity reached");
    }
    return this.addSession(room, displayName, account);
  }

  restoreParticipantId(roomId: string, accountId: string, participantId: string) {
    const room = this.requireRoom(roomId);
    for (const session of room.sessions.values()) {
      if (session.accountId === accountId) session.participant.participantId = participantId;
    }
    this.broadcast(room);
  }

  get(roomId: string): RoomState {
    return this.snapshot(this.requireRoom(roomId));
  }

  /** Private incarnation identifier, never a reusable room-code history key. */
  getHistoryId(roomId: string): string {
    return this.requireRoom(roomId).historyId;
  }

  heartbeat(roomId: string, sessionId: string): Participant {
    const room = this.requireRoom(roomId);
    const session = room.sessions.get(sessionId);
    if (!session) throw new RoomError(404, "Active participant session not found");
    session.lastSeenAt = this.now();
    return copyParticipant(session.participant);
  }
  /** Authenticate without extending the existing presence lease. */
  getSessionParticipant(roomId: string, sessionId: string): Participant {
    const session = this.requireRoom(roomId).sessions.get(sessionId);
    if (!session) throw new RoomError(404, "Active participant session not found");
    return copyParticipant(session.participant);
  }
  /** Host can mute or request unmute; only the owner of the mic can accept and activate it. */
  controlMicrophone(roomId: string, credential: string, targetId: string, action: "mute" | "unmute" | "request-unmute"): RoomState {
    const room = this.requireRoom(roomId);
    const actor = room.sessions.get(credential);
    if (!actor) throw new RoomError(401, "Invalid or expired room session");
    const target = [...room.sessions.values()].find(s => s.participant.participantId === targetId);
    if (!target) throw new RoomError(404, "Participant not found in this room");
    const isSelf = actor.participant.participantId === targetId;
    const isHost = actor.participant.participantId === room.hostParticipantId;
    if (!isSelf && !isHost) throw new RoomError(403, "Only the room creator can control other participants");
    if (action === "request-unmute") {
      if (!isHost || isSelf) throw new RoomError(403, "Only the room creator can request another participant to unmute");
      target.participant.hostMuted = false;
      target.participant.unmuteRequested = true;
    } else if (action === "unmute") {
      if (!isSelf) throw new RoomError(403, "A participant must accept their own unmute request");
      if (target.participant.hostMuted) throw new RoomError(403, "The room creator has muted your microphone");
      target.participant.micEnabled = true;
      target.participant.unmuteRequested = false;
    } else {
      target.participant.micEnabled = false;
      target.participant.unmuteRequested = false;
      if (!isSelf) target.participant.hostMuted = true;
    }
    this.broadcast(room);
    return this.snapshot(room);
  }

  leave(roomId: string, sessionId: string): void {
    const room = this.requireRoom(roomId);
    if (!room.sessions.delete(sessionId)) {
      throw new RoomError(404, "Active participant session not found");
    }
    if (room.sessions.size === 0) room.emptySince = this.now();
    this.broadcast(room);
  }

  subscribe(roomId: string, listener: Listener): () => void {
    const room = this.requireRoom(roomId);
    if (room.listeners.size >= (room.community ? 2000 : 100)) {
      throw new RoomError(503, "University event subscriber capacity reached");
    }
    room.listeners.add(listener);
    return () => room.listeners.delete(listener);
  }

  sweep(): void {
    for (const room of this.rooms.values()) this.expire(room);
  }
  /** Profile edits affect only sessions owned by that authenticated account.
   * Presence leases and public participant IDs remain unchanged. */
  updateAccountIdentity(accountId: string, displayName: string, identity: EmojiIdentity, photoUrl?: string | null): void {
    for (const room of this.rooms.values()) {
      this.expire(room);
      let changed = false;
      for (const session of room.sessions.values()) {
        if (session.accountId !== accountId) continue;
        session.participant.displayName = displayName;
        session.participant.identity = { ...identity };
        if (photoUrl !== undefined) session.participant.photoUrl = photoUrl;
        changed = true;
      }
      if (changed) this.broadcast(room);
    }
  }

  private requireRoom(roomId: string): Room {
    const id = roomId.toUpperCase();
    const room = this.rooms.get(id);
    if (room) this.expire(room);
    if (!room || !this.rooms.has(id)) {
      throw new RoomError(404, "University not found or expired");
    }
    return room;
  }

  private addSession(room: Room, displayName: string, account?: AccountIdentity): RoomSession {
    const participantSessionId = randomUUID();
    const participantId = randomUUID();
    if (!room.hostParticipantId || (account && account.accountId === room.hostAccountId)) {
      room.hostParticipantId = participantId;
    }
    room.sessions.set(participantSessionId, {
      participant: {
        participantId,
        displayName,
        photoUrl: account?.photoUrl ?? null,
        joinedAt: new Date(this.now()),
        identity: account ? { ...account.identity } : null,
        isRegistered: !!account,
        micEnabled: false,
        hostMuted: false,
        unmuteRequested: false,
      },
      lastSeenAt: this.now(),
      accountId: account?.accountId,
    });
    room.emptySince = null;
    this.broadcast(room);
    if (ENABLE_ROOM_MOOD_VISUALS && account && !room.community) {
      room.mood.recordActivity(2);
      this.emit(room, { type: "room_mood_update", data: room.mood.current(room.roomId) });
    }
    return { participantSessionId, participantId, room: this.snapshot(room) };
  }

  private expire(room: Room): void {
    const now = this.now();
    let changed = false;
    for (const [id, session] of room.sessions) {
      if (now - session.lastSeenAt >= SESSION_TIMEOUT_MS) {
        room.sessions.delete(id);
        changed = true;
      }
    }
    if (changed) {
      if (room.sessions.size === 0) room.emptySince = now;
      this.broadcast(room);
    }
    if (!room.community && room.emptySince !== null && now - room.emptySince >= EMPTY_ROOM_TIMEOUT_MS) {
      this.rooms.delete(room.roomId);
      this.emit(room, { type: "room.expired", data: { roomId: room.roomId } });
      room.listeners.clear();
    }
  }

  private snapshot(room: Room): RoomState {
    return {
      roomId: room.roomId,
      name: room.name,
      capacity: room.capacity,
      createdAt: new Date(room.createdAt),
      hostParticipantId: room.hostParticipantId,
      participants: Array.from(room.sessions.values(), ({ participant }) => copyParticipant(participant)),
      ...(room.community ? { communityAtmosphere: room.community.current() } : {}),
    };
  }

  private broadcast(room: Room): void {
    this.emit(room, { type: "room.snapshot", data: this.snapshot(room) });
  }

  private emit(room: Room, event: RoomEvent): void {
    for (const listener of room.listeners) listener(event);
  }

  requireAccountMember(roomId: string, sessionId: string, accountId: string): Participant {
    const session = this.requireRoom(roomId).sessions.get(sessionId);
    if (!session || session.accountId !== accountId) {
      throw new RoomError(401, "This university session does not belong to your account");
    }
    return copyParticipant(session.participant);
  }

  sessionAccountId(roomId: string, participantId: string): string | undefined {
    for (const session of this.requireRoom(roomId).sessions.values())
      if (session.participant.participantId === participantId) return session.accountId;
    return undefined;
  }

  publishChat(roomId: string, historyId: string, accepted: ChatAccepted, senderAccountId?: string): void {
    const room = this.rooms.get(roomId.toUpperCase());
    if (room?.historyId !== historyId) return;
    this.emit(room, { type: "chat.accepted", data: accepted, senderAccountId });
    if (ENABLE_ROOM_MOOD_VISUALS && !room.community) {
      for (const data of room.mood.record(room.roomId, accepted.message.id, accepted.message.text)) {
        this.emit(room, { type: "emoji_particle", data });
      }
      this.emit(room, { type: "room_mood_update", data: room.mood.current(room.roomId) });
    }
  }

  getRoomMood(roomId: string): RoomMoodUpdate {
    const room = this.requireRoom(roomId);
    return room.mood.current(room.roomId);
  }

  /** Called by the server's three-minute timer, including quiet rooms. */
  tickRoomMoods(): void {
    if (!ENABLE_ROOM_MOOD_VISUALS) return;
    this.sweep();
    for (const room of this.rooms.values()) {
      if (room.community) continue;
      this.emit(room, { type: "room_mood_update", data: room.mood.compute(room.roomId) });
    }
  }

  /** Autonomous scenes and decaying energy; the emoji mood keeps its own cadence. */
  tickRoomAtmospheres(): void {
    if (!ENABLE_ROOM_MOOD_VISUALS) return;
    this.sweep();
    for (const room of this.rooms.values()) {
      if (room.community) continue;
      if (!room.sessions.size) continue;
      this.emit(room, { type: "room_mood_update", data: room.mood.current(room.roomId) });
    }
  }
}

export const roomStore = new RoomStore();
