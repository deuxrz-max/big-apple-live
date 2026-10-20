import type { UniversityAudioState } from "@workspace/api-zod";
import { RoomError, RoomStore, roomStore } from "./room-store";

export const UNIVERSITY_BEAM_SLOT_COUNT = 4;
export const UNIVERSITY_BEAM_KICK_COOLDOWN_MS = 60_000;

type Slot = {
  slotNumber: number;
  participantId: string | null;
  accountId: string | null;
  joinedAt: number | null;
  micEnabled: boolean;
  mutedByHost: boolean;
};
type Beam = {
  roomId: string;
  historyId: string;
  slots: Slot[];
  hostParticipantId: string | null;
  listeners: Set<(state: UniversityAudioState) => void>;
  unsubscribeRoom: () => void;
};

/** In-memory university beam state; media is never sent through this server. */
export class UniversityAudioBeamStore {
  private readonly beams = new Map<string, Beam>();
  private readonly kickedUntil = new Map<string, number>();

  constructor(private readonly rooms: RoomStore = roomStore, private readonly now: () => number = Date.now) {}

  getState(roomId: string): UniversityAudioState {
    const beam = this.ensure(roomId);
    this.pruneMissingParticipants(beam);
    return this.toState(beam);
  }

  subscribe(roomId: string, listener: (state: UniversityAudioState) => void): () => void {
    const beam = this.ensure(roomId);
    beam.listeners.add(listener);
    listener(this.toState(beam));
    return () => beam.listeners.delete(listener);
  }

  assertCanJoin(roomId: string, accountId: string): void {
    const historyId = this.rooms.getHistoryId(roomId);
    const key = this.kickKey(roomId, historyId, accountId);
    const until = this.kickedUntil.get(key);
    if (!until) return;
    if (until <= this.now()) {
      this.kickedUntil.delete(key);
      return;
    }
    throw new RoomError(409, "You were removed from this room. Please wait a moment before rejoining.");
  }

  joinSlot(roomId: string, participantId: string, accountId: string): UniversityAudioState {
    const beam = this.ensure(roomId);
    this.assertCanJoin(roomId, accountId);
    const existing = beam.slots.find(slot => slot.participantId === participantId);
    if (existing) return this.toState(beam);
    if (beam.slots.some(slot => slot.accountId === accountId)) return this.toState(beam);
    const slot = beam.slots.find(candidate => candidate.participantId === null);
    if (!slot) throw new RoomError(409, "All four speaker spots are full. You can still listen and chat.");
    slot.participantId = participantId;
    slot.accountId = accountId;
    slot.joinedAt = this.now();
    slot.micEnabled = false;
    slot.mutedByHost = false;
    if (!beam.hostParticipantId) beam.hostParticipantId = participantId;
    this.publish(beam);
    return this.toState(beam);
  }

  leaveSlot(roomId: string, participantId: string): UniversityAudioState {
    const beam = this.ensure(roomId);
    const slot = beam.slots.find(candidate => candidate.participantId === participantId);
    if (slot) this.releaseSlot(beam, slot);
    this.publish(beam);
    return this.toState(beam);
  }

  setOwnMicrophone(roomId: string, participantId: string, enabled: boolean): UniversityAudioState {
    const beam = this.ensure(roomId);
    const slot = this.requireSlot(beam, participantId);
    if (enabled && slot.mutedByHost) {
      throw new RoomError(403, "The host has muted your microphone. Ask them to allow you to unmute.");
    }
    slot.micEnabled = enabled;
    this.publish(beam);
    return this.toState(beam);
  }

  hostMute(roomId: string, actorId: string, targetId: string, muted: boolean): UniversityAudioState {
    const beam = this.ensure(roomId);
    this.requireHost(beam, actorId);
    if (actorId === targetId) throw new RoomError(400, "Use your own microphone control to mute yourself.");
    const target = this.requireSlot(beam, targetId);
    target.micEnabled = false;
    target.mutedByHost = muted;
    this.publish(beam);
    return this.toState(beam);
  }

  kick(roomId: string, actorId: string, targetId: string): { state: UniversityAudioState; accountId: string } {
    const beam = this.ensure(roomId);
    this.requireHost(beam, actorId);
    if (actorId === targetId) throw new RoomError(400, "You cannot remove yourself from your own beam.");
    const target = this.requireSlot(beam, targetId);
    const accountId = target.accountId;
    if (!accountId) throw new RoomError(404, "Speaker is no longer in this room.");
    this.kickedUntil.set(this.kickKey(beam.roomId, beam.historyId, accountId),
      this.now() + UNIVERSITY_BEAM_KICK_COOLDOWN_MS);
    this.releaseSlot(beam, target);
    this.publish(beam);
    return { state: this.toState(beam), accountId };
  }

  private ensure(roomId: string): Beam {
    const id = roomId.toUpperCase();
    if (!this.rooms.isCommunity(id)) throw new RoomError(404, "Room not found.");
    const historyId = this.rooms.getHistoryId(id);
    const key = `${id}:${historyId}`;
    let beam = this.beams.get(key);
    if (beam) return beam;
    beam = {
      roomId: id, historyId, hostParticipantId: null,
      slots: Array.from({ length: UNIVERSITY_BEAM_SLOT_COUNT }, (_, i) => ({
        slotNumber: i + 1, participantId: null, accountId: null, joinedAt: null,
        micEnabled: false, mutedByHost: false,
      })),
      listeners: new Set(), unsubscribeRoom: () => {},
    };
    this.beams.set(key, beam);
    beam.unsubscribeRoom = this.rooms.subscribe(id, event => {
      if (event.type === "room.snapshot") this.pruneMissingParticipants(beam!);
    });
    return beam;
  }

  private pruneMissingParticipants(beam: Beam): void {
    const present = new Set(this.rooms.get(beam.roomId).participants.map(person => person.participantId));
    let changed = false;
    for (const slot of beam.slots) {
      if (slot.participantId && !present.has(slot.participantId)) {
        this.releaseSlot(beam, slot);
        changed = true;
      }
    }
    if (changed) this.publish(beam);
  }

  private releaseSlot(beam: Beam, slot: Slot): void {
    slot.participantId = null;
    slot.accountId = null;
    slot.joinedAt = null;
    slot.micEnabled = false;
    slot.mutedByHost = false;
    if (beam.hostParticipantId && !beam.slots.some(s => s.participantId === beam.hostParticipantId)) {
      beam.hostParticipantId = [...beam.slots]
        .filter(s => s.participantId && s.joinedAt !== null)
        .sort((a, b) => a.joinedAt! - b.joinedAt!)[0]?.participantId ?? null;
    }
  }

  private requireSlot(beam: Beam, participantId: string): Slot {
    const slot = beam.slots.find(candidate => candidate.participantId === participantId);
    if (!slot) throw new RoomError(404, "You are not in a speaker spot.");
    return slot;
  }

  private requireHost(beam: Beam, participantId: string): void {
    if (!beam.hostParticipantId || beam.hostParticipantId !== participantId) {
      throw new RoomError(403, "Only the beam host can control another speaker.");
    }
  }

  private toState(beam: Beam): UniversityAudioState {
    return {
      roomId: beam.roomId,
      beamActive: beam.slots.some(slot => slot.participantId !== null),
      hostParticipantId: beam.hostParticipantId,
      slots: beam.slots.map(({ slotNumber, participantId, micEnabled, mutedByHost }) =>
        ({ slotNumber, participantId, micEnabled, mutedByHost })),
    };
  }

  private publish(beam: Beam): void {
    const state = this.toState(beam);
    for (const listener of beam.listeners) listener(state);
  }

  private kickKey(roomId: string, historyId: string, accountId: string): string {
    return `${roomId.toUpperCase()}:${historyId}:${accountId}`;
  }
}

export const universityAudioBeamStore = new UniversityAudioBeamStore();
