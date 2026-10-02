import { randomBytes, randomUUID } from "node:crypto";
import type { Participant, RoomSession, RoomState } from "@workspace/api-zod";

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
type ActiveSession = { participant: Participant; lastSeenAt: number };
type Room = {
  roomId: string;
  createdAt: Date;
  sessions: Map<string, ActiveSession>;
  listeners: Set<Listener>;
  emptySince: number | null;
};

/** Single-process, ephemeral presence store. Session credentials are never in snapshots. */
export class RoomStore {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly now: () => number = Date.now) {}

  create(displayName: string): RoomSession {
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
      sessions: new Map(),
      listeners: new Set(),
      emptySince: null,
    };
    this.rooms.set(roomId, room);
    return this.addSession(room, displayName);
  }

  join(roomId: string, displayName: string): RoomSession {
    const room = this.requireRoom(roomId);
    if (room.sessions.size >= 100) {
      throw new RoomError(409, "Room participant capacity reached");
    }
    return this.addSession(room, displayName);
  }

  get(roomId: string): RoomState {
    return this.snapshot(this.requireRoom(roomId));
  }

  heartbeat(roomId: string, sessionId: string): Participant {
    const room = this.requireRoom(roomId);
    const session = room.sessions.get(sessionId);
    if (!session) throw new RoomError(404, "Active participant session not found");
    session.lastSeenAt = this.now();
    return { ...session.participant };
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

  private requireRoom(roomId: string): Room {
    const id = roomId.toUpperCase();
    const room = this.rooms.get(id);
    if (room) this.expire(room);
    if (!room || !this.rooms.has(id)) {
      throw new RoomError(404, "Room not found or expired");
    }
    return room;
  }

  private addSession(room: Room, displayName: string): RoomSession {
    const participantSessionId = randomUUID();
    room.sessions.set(participantSessionId, {
      participant: {
        participantId: randomUUID(),
        displayName,
        joinedAt: new Date(this.now()),
      },
      lastSeenAt: this.now(),
    });
    room.emptySince = null;
    this.broadcast(room);
    return { participantSessionId, room: this.snapshot(room) };
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
      participants: Array.from(room.sessions.values(), ({ participant }) => ({
        ...participant,
        joinedAt: new Date(participant.joinedAt),
      })),
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