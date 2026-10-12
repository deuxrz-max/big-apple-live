import { createHash } from "node:crypto";
import type { UniversityVideoBeamState } from "@workspace/api-zod";
import { RoomError, RoomStore, roomStore } from "./room-store";

export const VIDEO_BEAM_SLOT_COUNT = 4;
export const VIDEO_BEAM_KICK_COOLDOWN_MS = 60_000;
export const VIDEO_BEAM_CONNECT_GRACE_MS = 90_000;

type BeamSlot = {
  slotNumber: number;
  participantId: string | null;
  accountId: string | null;
  joinedAt: number | null;
  connectedAt: number | null;
  micMuted: boolean;
  cameraOff: boolean;
  mutedByHost: boolean;
  cameraDisabledByHost: boolean;
};

type Beam = {
  roomId: string;
  historyId: string;
  hostParticipantId: string | null;
  slots: BeamSlot[];
};

export class UniversityVideoBeamStore {
  private readonly beams = new Map<string, Beam>();
  private readonly kickedUntil = new Map<string, number>();

  constructor(
    private readonly rooms: RoomStore = roomStore,
    private readonly now: () => number = Date.now,
  ) {}

  getRoomName(roomId: string): string {
    const id = roomId.toUpperCase();
    if (!this.rooms.isCommunity(id)) throw new RoomError(404, "University not found.");
    return `streamtalk-${createHash("sha256")
      .update(`${id}:${this.rooms.getHistoryId(id)}`)
      .digest("hex")
      .slice(0, 32)}`;
  }

  getState(roomId: string): UniversityVideoBeamState {
    return this.toState(this.ensure(roomId));
  }

  assertCanJoin(roomId: string, accountId: string): void {
    const beam = this.ensure(roomId);
    const key = this.kickKey(beam, accountId);
    const until = this.kickedUntil.get(key);
    if (!until) return;
    if (until <= this.now()) {
      this.kickedUntil.delete(key);
      return;
    }
    throw new RoomError(409, "You were removed from this beam. Please wait a moment before rejoining.");
  }

  joinSlot(roomId: string, participantId: string, accountId: string): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    this.assertCanJoin(roomId, accountId);
    if (this.rooms.sessionAccountId(beam.roomId, participantId) !== accountId) {
      throw new RoomError(401, "This university session does not belong to your account.");
    }
    const existing = beam.slots.find(slot => slot.participantId === participantId);
    if (existing) return this.toState(beam);
    if (beam.slots.some(slot => slot.accountId === accountId)) {
      throw new RoomError(409, "You already have a speaker spot in this beam.");
    }
    const slot = beam.slots.find(candidate => candidate.participantId === null);
    if (!slot) throw new RoomError(409, "All four speaker spots are full. You can still watch and chat.");
    slot.participantId = participantId;
    slot.accountId = accountId;
    slot.joinedAt = this.now();
    slot.connectedAt = null;
    slot.micMuted = false;
    slot.cameraOff = false;
    slot.mutedByHost = false;
    slot.cameraDisabledByHost = false;
    if (!beam.hostParticipantId) beam.hostParticipantId = participantId;
    return this.toState(beam);
  }

  reconcileLiveKitParticipants(roomId: string, identities: ReadonlySet<string>): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    let changed = false;
    for (const slot of beam.slots) {
      if (!slot.participantId || identities.has(slot.participantId)) continue;
      if (slot.connectedAt === null && slot.joinedAt !== null
        && this.now() - slot.joinedAt < VIDEO_BEAM_CONNECT_GRACE_MS) continue;
      this.release(beam, slot);
      changed = true;
    }
    if (changed) this.transferHostIfNeeded(beam);
    return this.toState(beam);
  }

  leaveSlot(roomId: string, participantId: string): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    const slot = this.requireSlot(beam, participantId);
    this.release(beam, slot);
    this.transferHostIfNeeded(beam);
    return this.toState(beam);
  }

  markConnected(roomId: string, participantId: string): UniversityVideoBeamState {
    const slot = this.requireSlot(this.ensure(roomId), participantId);
    slot.connectedAt = this.now();
    return this.getState(roomId);
  }

  assertSelfMedia(roomId: string, participantId: string, media: "mic" | "camera", enabled: boolean): void {
    void media;
    void enabled;
    this.requireSlot(this.ensure(roomId), participantId);
  }

  setSelfMedia(roomId: string, participantId: string, media: "mic" | "camera", enabled: boolean): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    this.assertSelfMedia(roomId, participantId, media, enabled);
    const slot = this.requireSlot(beam, participantId);
    if (media === "mic") {
      slot.micMuted = !enabled;
      if (enabled) slot.mutedByHost = false;
    } else {
      slot.cameraOff = !enabled;
      if (enabled) slot.cameraDisabledByHost = false;
    }
    return this.toState(beam);
  }

  assertHostControl(roomId: string, actorId: string, targetId: string): BeamSlot {
    const beam = this.ensure(roomId);
    this.requireHost(beam, actorId);
    if (actorId === targetId) throw new RoomError(400, "Use your own controls for your media.");
    return this.requireSlot(beam, targetId);
  }

  hostDisableMedia(roomId: string, actorId: string, targetId: string, media: "mic" | "camera"): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    const slot = this.assertHostControl(roomId, actorId, targetId);
    if (media === "mic") {
      slot.micMuted = true;
      slot.mutedByHost = true;
    } else {
      slot.cameraOff = true;
      slot.cameraDisabledByHost = true;
    }
    return this.toState(beam);
  }

  kick(roomId: string, actorId: string, targetId: string): { state: UniversityVideoBeamState; accountId: string } {
    const beam = this.ensure(roomId);
    const target = this.assertHostControl(roomId, actorId, targetId);
    const accountId = target.accountId;
    if (!accountId) throw new RoomError(404, "Speaker is no longer in this room.");
    this.kickedUntil.set(this.kickKey(beam, accountId), this.now() + VIDEO_BEAM_KICK_COOLDOWN_MS);
    this.release(beam, target);
    this.transferHostIfNeeded(beam);
    return { state: this.toState(beam), accountId };
  }

  slotFor(roomId: string, participantId: string): UniversityVideoBeamState["slots"][number] {
    const slot = this.requireSlot(this.ensure(roomId), participantId);
    return this.toState(this.ensure(roomId)).slots[slot.slotNumber - 1]!;
  }

  private ensure(roomId: string): Beam {
    const id = roomId.toUpperCase();
    if (!this.rooms.isCommunity(id)) throw new RoomError(404, "University not found.");
    const historyId = this.rooms.getHistoryId(id);
    const key = `${id}:${historyId}`;
    let beam = this.beams.get(key);
    if (!beam) {
      beam = {
        roomId: id,
        historyId,
        hostParticipantId: null,
        slots: Array.from({ length: VIDEO_BEAM_SLOT_COUNT }, (_, i) => ({
          slotNumber: i + 1,
          participantId: null,
          accountId: null,
          joinedAt: null,
          connectedAt: null,
          micMuted: true,
          cameraOff: true,
          mutedByHost: false,
          cameraDisabledByHost: false,
        })),
      };
      this.beams.set(key, beam);
    }
    return beam;
  }

  private requireSlot(beam: Beam, participantId: string): BeamSlot {
    const slot = beam.slots.find(candidate => candidate.participantId === participantId);
    if (!slot) throw new RoomError(404, "You are not in a speaker spot.");
    return slot;
  }

  private requireHost(beam: Beam, participantId: string): void {
    if (!beam.hostParticipantId || beam.hostParticipantId !== participantId) {
      throw new RoomError(403, "Only the beam host can control another speaker.");
    }
  }

  private release(beam: Beam, slot: BeamSlot): void {
    slot.participantId = null;
    slot.accountId = null;
    slot.joinedAt = null;
    slot.connectedAt = null;
    slot.micMuted = true;
    slot.cameraOff = true;
    slot.mutedByHost = false;
    slot.cameraDisabledByHost = false;
  }

  private transferHostIfNeeded(beam: Beam): void {
    if (beam.hostParticipantId && !beam.slots.some(slot => slot.participantId === beam.hostParticipantId)) {
      beam.hostParticipantId = [...beam.slots]
        .filter(slot => slot.participantId && slot.joinedAt !== null)
        .sort((a, b) => a.joinedAt! - b.joinedAt!)[0]?.participantId ?? null;
    }
  }

  private toState(beam: Beam): UniversityVideoBeamState {
    return {
      roomId: beam.roomId,
      beamActive: beam.slots.some(slot => slot.participantId !== null),
      hostParticipantId: beam.hostParticipantId,
      slots: beam.slots.map(({ slotNumber, participantId, micMuted, cameraOff, mutedByHost, cameraDisabledByHost }) => ({
        slotNumber,
        participantId,
        micMuted,
        cameraOff,
        mutedByHost,
        cameraDisabledByHost,
      })),
    };
  }

  private kickKey(beam: Beam, accountId: string): string {
    return `${beam.roomId}:${beam.historyId}:${accountId}`;
  }
}

export const universityVideoBeamStore = new UniversityVideoBeamStore();
