import { randomBytes, randomUUID } from "node:crypto";
import type { Participant, RoomSession, RoomState, EmojiIdentity } from "@workspace/api-zod";

export const SESSION_TIMEOUT_MS = 90_000;
export const EMPTY_ROOM_TIMEOUT_MS = 60 * 60 * 1000;

export class RoomError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

type RoomEvent =
  | { type: "room.snapshot"; data: RoomState }
  | { type: "room.expired"; data: { roomId: string } };
type Listener = (event: RoomEvent) => void;
type ActiveSession = { participant: Participant; lastSeenAt: number; accountId?: string };
type AccountIdentity = { accountId: string; identity: EmojiIdentity };
function copyParticipant(participant: Participant): Participant {
  return {
    ...participant, joinedAt: new Date(participant.joinedAt),
    identity: participant.identity ? { ...participant.identity } : null,
  };
}
type Room = {
  roomId: string;
  createdAt: Date;
  hostParticipantId: string;
  sessions: Map<string, ActiveSession>;
  listeners: Set<Listener>;
  emptySince: number | null;
};

/** Single-process, ephemeral presence store. Session credentials are never in snapshots. */
export class RoomStore {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly now: () => number = Date.now) {}

  create(displayName: string, account?: AccountIdentity): RoomSession {
    this.sweep();
    if (this.rooms.size >= 10_000) {
      throw new RoomError(503, "Room capacity reached");
    }
    let roomId: string;
    do {
      roomId = randomBytes(6).toString("hex").toUpperCase();
    } while (this.rooms.has(roomId));
    const room: Room = {
      roomId,
      createdAt: new Date(this.now()),
      hostParticipantId: "",
      sessions: new Map(),
      listeners: new Set(),
      emptySince: null,
    };
    this.rooms.set(roomId, room);
    return this.addSession(room, displayName, account);
  }

  join(roomId: string, displayName: string, account?: AccountIdentity): RoomSession {
    const room = this.requireRoom(roomId);
    if (room.sessions.size >= 100) {
      throw new RoomError(409, "Room participant capacity reached");
    }
    return this.addSession(room, displayName, account);
  }

  get(roomId: string): RoomState {
    return this.snapshot(this.requireRoom(roomId));
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
    if (room.listeners.size >= 100) {
      throw new RoomError(503, "Room event subscriber capacity reached");
    }
    room.listeners.add(listener);
    return () => room.listeners.delete(listener);
  }

  sweep(): void {
    for (const room of this.rooms.values()) this.expire(room);
  }

  /** Profile edits affect only sessions owned by that authenticated account.
   * Presence leases and public participant IDs remain unchanged. */
  updateAccountIdentity(accountId: string, displayName: string, identity: EmojiIdentity): void {
    for (const room of this.rooms.values()) {
      this.expire(room);
      let changed = false;
      for (const session of room.sessions.values()) {
        if (session.accountId !== accountId) continue;
        session.participant.displayName = displayName;
        session.participant.identity = { ...identity };
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
      throw new RoomError(404, "Room not found or expired");
    }
    return room;
  }

  private addSession(room: Room, displayName: string, account?: AccountIdentity): RoomSession {
    const participantSessionId = randomUUID();
    const participantId = randomUUID();
    if (!room.hostParticipantId) room.hostParticipantId = participantId;
    room.sessions.set(participantSessionId, {
      participant: {
        participantId,
        displayName,
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
    if (room.emptySince !== null && now - room.emptySince >= EMPTY_ROOM_TIMEOUT_MS) {
      this.rooms.delete(room.roomId);
      this.emit(room, { type: "room.expired", data: { roomId: room.roomId } });
      room.listeners.clear();
    }
  }

  private snapshot(room: Room): RoomState {
    return {
      roomId: room.roomId,
      createdAt: new Date(room.createdAt),
      hostParticipantId: room.hostParticipantId,
      participants: Array.from(room.sessions.values(), ({ participant }) => copyParticipant(participant)),
    };
  }

  private broadcast(room: Room): void {
    this.emit(room, { type: "room.snapshot", data: this.snapshot(room) });
  }

  private emit(room: Room, event: RoomEvent): void {
    for (const listener of room.listeners) listener(event);
  }
}

export const roomStore = new RoomStore();