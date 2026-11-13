import { createHash } from "node:crypto";
import type { UniversityVideoBeamState } from "@workspace/api-zod";
import { RoomError, RoomStore, roomStore } from "./room-store";
import { isPublicTopicRoom } from "./community-config";

export const VIDEO_BEAM_SLOT_COUNT = 9;
export const VIDEO_BEAM_CONNECT_GRACE_MS = 90_000;

type BeamSlot = {
  slotNumber: number;
  participantId: string | null;
  accountId: string | null;
  joinedAt: number | null;
  connectedAt: number | null;
  micMuted: boolean;
  mutedByHost: boolean;
  cameraOff: true;
  cameraDisabledByHost: false;
};
type Beam = {
  roomId: string;
  historyId: string;
  hostParticipantId: string | null;
  slots: BeamSlot[];
};
export type BeamSeatLifecycleEvent = {
  type: "joined" | "left";
  roomId: string;
  accountId: string;
  participantId: string;
  at: number;
};

/** Nine-seat audio presence and moderation state. Video playback and camera state are not supported. */
export class UniversityVideoBeamStore {
  private readonly beams = new Map<string, Beam>();
  private seatLifecycleListener: ((event: BeamSeatLifecycleEvent) => void) | null = null;

  constructor(
    private readonly rooms: RoomStore = roomStore,
    private readonly now: () => number = Date.now,
  ) {}

  setSeatLifecycleListener(listener: ((event: BeamSeatLifecycleEvent) => void) | null): void {
    this.seatLifecycleListener = listener;
  }

  connectedSeatOccupants(roomId: string): { accountId: string; participantId: string; slotNumber: number }[] {
    const beam = this.find(roomId);
    if (!beam) return [];
    return beam.slots.flatMap(slot => slot.accountId && slot.participantId && slot.connectedAt !== null
      ? [{ accountId: slot.accountId, participantId: slot.participantId, slotNumber: slot.slotNumber }]
      : []);
  }

  getRoomName(roomId: string): string {
    const beam = this.ensure(roomId);
    return `streamtalk-${createHash("sha256")
      .update(`${beam.roomId}:${beam.historyId}`).digest("hex").slice(0, 32)}`;
  }

  getState(roomId: string, viewerAccountId?: string): UniversityVideoBeamState {
    return this.toState(this.ensure(roomId), viewerAccountId);
  }

  assertCanJoin(_roomId: string, _accountId: string): void {
    // Persistent room-incarnation kick checks are enforced by the route layer.
  }

  joinSlot(roomId: string, participantId: string, accountId: string, targetSlotNumber?: number): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    this.assertCanJoin(roomId, accountId);
    if (this.rooms.sessionAccountId(beam.roomId, participantId) !== accountId) {
      throw new RoomError(401, "This room session does not belong to your account.");
    }
    const existing = beam.slots.find(slot => slot.participantId === participantId);
    if (existing) return this.toState(beam);
    if (beam.slots.some(slot => slot.accountId === accountId)) {
      throw new RoomError(409, "You already have a speaker spot in this room.");
    }
    const slot = targetSlotNumber === undefined
      ? beam.slots.find(candidate => candidate.participantId === null)
      : beam.slots.find(candidate => candidate.slotNumber === targetSlotNumber);
    if (targetSlotNumber !== undefined && !slot) throw new RoomError(400, "Choose an available player box.");
    if (!slot || slot.participantId) throw new RoomError(409, "That player box is unavailable. You can still listen and chat.");
    slot.participantId = participantId;
    slot.accountId = accountId;
    slot.joinedAt = this.now();
    slot.connectedAt = null;
    slot.micMuted = true;
    slot.mutedByHost = false;
    slot.cameraOff = true;
    slot.cameraDisabledByHost = false;
    this.notifySeatLifecycle({ type: "joined", roomId: beam.roomId, accountId, participantId, at: this.now() });
    if (!this.isOwnerlessTopicRoom(beam.roomId) && !beam.hostParticipantId) beam.hostParticipantId = participantId;
    return this.toState(beam);
  }

  moveSlot(roomId: string, participantId: string, accountId: string, targetSlotNumber: number): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    this.assertCanJoin(roomId, accountId);
    if (this.rooms.sessionAccountId(beam.roomId, participantId) !== accountId) {
      throw new RoomError(401, "This room session does not belong to your account.");
    }
    const current = beam.slots.find(slot => slot.participantId === participantId && slot.accountId === accountId);
    if (!current) throw new RoomError(404, "You are not in a speaker spot.");
    const target = beam.slots.find(slot => slot.slotNumber === targetSlotNumber);
    if (!target) throw new RoomError(400, "Choose an available player box.");
    if (target === current) return this.toState(beam);
    if (target.participantId !== null) throw new RoomError(409, "That speaker spot is already occupied.");
    Object.assign(target, current);
    target.slotNumber = targetSlotNumber;
    this.clearSlot(current);
    return this.toState(beam);
  }

  reconcileLiveKitParticipants(roomId: string, identities: ReadonlySet<string>, viewerAccountId?: string): UniversityVideoBeamState {
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
    return this.toState(beam, viewerAccountId);
  }

  leaveSlot(roomId: string, participantId: string): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    this.release(beam, this.requireSlot(beam, participantId));
    this.transferHostIfNeeded(beam);
    return this.toState(beam);
  }

  markConnected(roomId: string, participantId: string): UniversityVideoBeamState {
    this.requireSlot(this.ensure(roomId), participantId).connectedAt = this.now();
    return this.getState(roomId);
  }

  assertSelfMedia(roomId: string, participantId: string, media: "mic" | "camera", _enabled: boolean): void {
    this.requireSlot(this.ensure(roomId), participantId);
    if (media === "camera") throw new RoomError(410, "Room seats are audio-only. Camera access is not available in rooms.");
  }

  setSelfMedia(roomId: string, participantId: string, media: "mic" | "camera", enabled: boolean): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    this.assertSelfMedia(roomId, participantId, media, enabled);
    const slot = this.requireSlot(beam, participantId);
    slot.micMuted = !enabled;
    if (enabled) slot.mutedByHost = false;
    return this.toState(beam);
  }

  assertHostControl(roomId: string, actorId: string, targetId: string): BeamSlot {
    const beam = this.ensure(roomId);
    this.requireHost(beam, actorId);
    if (actorId === targetId) throw new RoomError(400, "Use your own controls for your microphone.");
    return this.requireSlot(beam, targetId);
  }

  moderatorDisableMedia(roomId: string, actorId: string, targetId: string, media: "mic" | "camera"): UniversityVideoBeamState {
    if (media === "camera") throw new RoomError(410, "Room seats are audio-only.");
    if (actorId === targetId) throw new RoomError(400, "Use your own controls for your microphone.");
    const slot = this.requireSlot(this.ensure(roomId), targetId);
    slot.micMuted = true;
    slot.mutedByHost = true;
    return this.getState(roomId);
  }

  kick(roomId: string, actorId: string, targetId: string): { state: UniversityVideoBeamState; accountId: string } {
    const beam = this.ensure(roomId);
    const target = this.assertHostControl(roomId, actorId, targetId);
    const accountId = target.accountId;
    if (!accountId) throw new RoomError(404, "Speaker is no longer in this room.");
    this.release(beam, target);
    this.transferHostIfNeeded(beam);
    return { state: this.toState(beam), accountId };
  }

  slotFor(roomId: string, participantId: string): UniversityVideoBeamState["slots"][number] {
    const slot = this.requireSlot(this.ensure(roomId), participantId);
    return this.toState(this.ensure(roomId)).slots[slot.slotNumber - 1]!;
  }

  isAccountMicrophoneActive(accountId: string): boolean {
    return [...this.beams.values()].some(beam => beam.slots.some(slot =>
      slot.accountId === accountId && slot.connectedAt !== null && !slot.micMuted && !slot.mutedByHost));
  }

  accountIdForParticipant(roomId: string, participantId: string): string | null {
    return this.requireSlot(this.ensure(roomId), participantId).accountId;
  }

  hostSeatNumber(roomId: string): number | null {
    const beam = this.ensure(roomId);
    return beam.slots.find(slot => slot.participantId === beam.hostParticipantId)?.slotNumber ?? null;
  }

  muteAccountMicrophones(accountId: string): Array<{ roomId: string; participantId: string }> {
    const muted: Array<{ roomId: string; participantId: string }> = [];
    for (const beam of this.beams.values()) {
      for (const slot of beam.slots) {
        if (slot.accountId !== accountId || !slot.participantId) continue;
        slot.micMuted = true;
        muted.push({ roomId: beam.roomId, participantId: slot.participantId });
      }
    }
    return muted;
  }

  private find(roomId: string): Beam | undefined {
    const id = roomId.toUpperCase();
    if (!this.rooms.isCommunity(id)) return undefined;
    return this.beams.get(`${id}:${this.rooms.getHistoryId(id)}`);
  }

  private ensure(roomId: string): Beam {
    const id = roomId.toUpperCase();
    if (!this.rooms.isCommunity(id)) throw new RoomError(404, "Room not found.");
    const historyId = this.rooms.getHistoryId(id);
    const key = `${id}:${historyId}`;
    let beam = this.beams.get(key);
    if (!beam) {
      beam = {
        roomId: id, historyId, hostParticipantId: null,
        slots: Array.from({ length: this.rooms.isSocialRoom(id) ? 4 : VIDEO_BEAM_SLOT_COUNT }, (_, index) => ({
          slotNumber: index + 1, participantId: null, accountId: null, joinedAt: null, connectedAt: null,
          micMuted: true, mutedByHost: false, cameraOff: true, cameraDisabledByHost: false,
        })),
      };
      this.beams.set(key, beam);
    }
    return beam;
  }

  private isOwnerlessTopicRoom(roomId: string): boolean {
    return isPublicTopicRoom(roomId, this.rooms);
  }

  private requireSlot(beam: Beam, participantId: string): BeamSlot {
    const slot = beam.slots.find(candidate => candidate.participantId === participantId);
    if (!slot) throw new RoomError(404, "You are not in a speaker spot.");
    return slot;
  }

  private requireHost(beam: Beam, participantId: string): void {
    if (this.isOwnerlessTopicRoom(beam.roomId)) {
      throw new RoomError(403, "Public topic rooms do not have host controls.");
    }
    const roomOwnerId = this.rooms.isSocialRoom(beam.roomId) ? this.rooms.hostAccountId(beam.roomId) : null;
    const isSocialRoomOwner = !!roomOwnerId && this.rooms.sessionAccountId(beam.roomId, participantId) === roomOwnerId;
    if ((!beam.hostParticipantId || beam.hostParticipantId !== participantId) && !isSocialRoomOwner) {
      throw new RoomError(403, "Only this room's host can control another speaker.");
    }
  }

  private clearSlot(slot: BeamSlot): void {
    slot.participantId = null;
    slot.accountId = null;
    slot.joinedAt = null;
    slot.connectedAt = null;
    slot.micMuted = true;
    slot.mutedByHost = false;
    slot.cameraOff = true;
    slot.cameraDisabledByHost = false;
  }

  private release(beam: Beam, slot: BeamSlot): void {
    if (slot.accountId && slot.participantId) {
      try {
        this.seatLifecycleListener?.({
          type: "left", roomId: beam.roomId, accountId: slot.accountId,
          participantId: slot.participantId, at: this.now(),
        });
      } catch { /* reward persistence cannot block a speaker leaving */ }
    }
    this.clearSlot(slot);
  }

  private notifySeatLifecycle(event: BeamSeatLifecycleEvent): void {
    try { this.seatLifecycleListener?.(event); } catch { /* room audio cannot depend on reward persistence */ }
  }

  private transferHostIfNeeded(beam: Beam): void {
    if (this.isOwnerlessTopicRoom(beam.roomId)) {
      beam.hostParticipantId = null;
      return;
    }
    if (beam.hostParticipantId && !beam.slots.some(slot => slot.participantId === beam.hostParticipantId)) {
      beam.hostParticipantId = [...beam.slots].filter(slot => slot.participantId && slot.joinedAt !== null)
        .sort((a, b) => a.joinedAt! - b.joinedAt!)[0]?.participantId ?? null;
    }
  }

  private toState(beam: Beam, _viewerAccountId?: string): UniversityVideoBeamState {
    const now = this.now();
    return {
      roomId: beam.roomId,
      beamActive: beam.slots.some(slot => slot.participantId !== null),
      hostParticipantId: beam.hostParticipantId,
      tv: {
        enabled: false, searchAvailable: false, defaultSearch: "", sourceType: null, sourceValue: null,
        playlistId: null, queue: [], videoMetadata: [], currentVideoId: null, startedAtMs: null, breakEndsAtMs: null,
        micLockedDuringVideo: false, skipVotingEnabled: false, skipVoteCount: 0, skipVoteTotal: 0,
        hasVotedToSkip: false, skipSequence: 0, seriesTitle: null, seriesDate: null,
        seriesEpisodeNumber: null, serverNowMs: now,
      },
      slots: beam.slots.map(slot => ({
        slotNumber: slot.slotNumber, participantId: slot.participantId,
        micMuted: slot.micMuted, cameraOff: slot.cameraOff, mutedByHost: slot.mutedByHost,
        cameraDisabledByHost: slot.cameraDisabledByHost,
      })),
    };
  }
}

export const universityVideoBeamStore = new UniversityVideoBeamStore();
