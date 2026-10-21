import { randomBytes, randomUUID } from "node:crypto";
import type { Participant, RoomSession, RoomState, EmojiIdentity, ChatAccepted, AccountRoomInput } from "@workspace/api-zod";
import { MONTHLY_CREDIT_BADGE_TIERS } from "./social/monthly-credit-badge-config";

export const SESSION_TIMEOUT_MS = 90_000;
export const EMPTY_ROOM_TIMEOUT_MS = 60 * 60 * 1000;

export class RoomError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

type RoomEvent =
  | { type: "chat.accepted"; data: ChatAccepted; senderAccountId?: string }
  | { type: "chat.refresh"; data: { roomId: string } }
  | { type: "room.entrance-effect"; data: RoomEntranceEffectEvent }
  | { type: "room.coin-drop"; data: RoomCoinDropEvent }
  | { type: "room.hangout-streak-reward"; data: { roomId: string; accountId: string; day: string; coins: number } }
  | { type: "room.snapshot"; data: RoomState }
  | { type: "room.kicked"; data: { roomId: string; accountId: string; message: string } }
  | { type: "room.expired"; data: { roomId: string } };
type Listener = (event: RoomEvent) => void;
export type RoomEntranceEffectEvent = {
  eventId: string;
  roomId: string;
  effectId: string;
  participantId: string;
  displayName: string;
  displayNameColor: string;
  displayNameTierIndex: number;
  effectName?: string;
  badgeImage?: string;
  assetFolder?: string;
  studioVersionId?: string;
  startedAt: number;
  durationMs: number;
};
export type RoomCoinDropEvent = {
  eventId: string;
  roomId: string;
  amount: number;
  startedAt: number;
};
type ActiveSession = { participant: Participant; lastSeenAt: number; accountId?: string; capExempt?: boolean };
type AccountIdentity = { accountId: string; identity: EmojiIdentity; photoUrl?: string | null; capExempt?: boolean; displayNameColor?: string; displayNameTierIndex?: number };
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
  /** Time when this room most recently reached its current participant count. */
  headcountSince: number;
  listeners: Set<Listener>;
  emptySince: number | null;
  community?: boolean;
  testOnly?: boolean;
  parentRoomId?: string | null;
  entranceEffects: RoomEntranceEffectEvent[];
  coinDrops: RoomCoinDropEvent[];
};

/** Single-process, ephemeral presence store. Session credentials are never in snapshots. */
export class RoomStore {
  private readonly rooms = new Map<string, Room>();
  private readonly entranceEffectOwners = new Map<string, { roomId: string; accountId: string }>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly allocateCode: (short: boolean) => string = short => randomBytes(short ? 3 : 6).toString("hex").toUpperCase(),
  ) {}

  registerCommunity(input: { roomId: string; historyId: string; label: string; createdAt: Date; testOnly?: boolean; parentRoomId?: string | null }) {
    const existing = this.rooms.get(input.roomId);
    if (existing) {
      existing.name = input.label;
      existing.parentRoomId = input.parentRoomId ?? existing.parentRoomId;
      return;
    }
    this.rooms.set(input.roomId, { roomId: input.roomId, historyId: input.historyId,
      // Public topic rooms have no audience cap. Capacity 0 is the API's
      // explicit unlimited value; the eight camera seats are tracked separately.
      name: input.label, capacity: 0, createdAt: input.createdAt, hostParticipantId: randomUUID(),
      sessions: new Map(), headcountSince: this.now(), listeners: new Set(), emptySince: null, community: true, testOnly: input.testOnly,
      parentRoomId: input.parentRoomId, entranceEffects: [], coinDrops: [] });
  }
  communityParentId(roomId: string) {
    const normalized = roomId.toUpperCase();
    const room = this.rooms.get(normalized);
    return room?.parentRoomId ?? room?.roomId ?? normalized;
  }
  communityLabel(roomId: string): string | null {
    return this.rooms.get(roomId.toUpperCase())?.name ?? null;
  }
  unregisterCommunity(roomId: string): void {
    const room = this.requireRoom(roomId);
    if (!room.community) throw new RoomError(409, "Only a topic room can be unregistered");
    if (room.sessions.size) throw new RoomError(409, "A room with active participants cannot be unregistered");
    this.rooms.delete(room.roomId);
  }
  /** Hide a community room without touching its persisted room or chat history. */
  deactivateCommunity(roomId: string): void {
    const id = roomId.toUpperCase();
    const room = this.rooms.get(id);
    if (!room?.community) return;
    this.emit(room, { type: "room.expired", data: { roomId: id } });
    room.listeners.clear();
    this.rooms.delete(id);
  }
  isCommunity(roomId: string) { return !!this.rooms.get(roomId.toUpperCase())?.community; }
  isTestOnly(roomId: string) { return !!this.rooms.get(roomId.toUpperCase())?.testOnly; }
  publicCommunityRoomIds(): string[] {
    return [...this.rooms.values()].filter(room => room.community && !room.testOnly).map(room => room.roomId);
  }
  /** Bots use this read-only list, never a participant session or a real seat. */
  occupiedUniversities() {
    const now = this.now();
    return [...this.rooms.values()].filter(room => room.community && !room.testOnly
      && [...room.sessions.values()].some(s => now - s.lastSeenAt < SESSION_TIMEOUT_MS)).map(room => room.roomId);
  }
  refreshRoomChat(roomId: string) {
    const room = this.rooms.get(roomId);
    if (room) this.emit(room, { type: "chat.refresh", data: { roomId } });
  }
  /** Read-only presence view: never renew a lease or disclose it without caller authorization. */
  latestUniversityForAccount(accountId: string): { roomId: string; label: string } | null {
    let latest: { roomId: string; label: string; at: number } | null = null;
    const now = this.now();
    for (const room of this.rooms.values()) {
      if (!room.community || room.testOnly) continue;
      for (const session of room.sessions.values()) {
        if (session.accountId !== accountId || now - session.lastSeenAt >= SESSION_TIMEOUT_MS) continue;
        if (!latest || session.lastSeenAt > latest.at)
          latest = { roomId: room.roomId, label: room.name, at: session.lastSeenAt };
      }
    }
    return latest ? { roomId: latest.roomId, label: latest.label } : null;
  }
  refreshChatVisibility() {
    for (const room of this.rooms.values()) if (room.community && !room.testOnly)
      this.emit(room, { type: "chat.refresh", data: { roomId: room.roomId } });
  }
  hasUniversitySeat(roomId: string, _accountId: string, _exempt = false) {
    this.requireRoom(roomId);
    // Community audiences are unlimited; beam slots are tracked separately.
    return true;
  }

  create(displayName: string, account?: AccountIdentity, beam?: AccountRoomInput): RoomSession {
    this.sweep();
    if (this.rooms.size >= 10_000) {
      throw new RoomError(503, "Room service capacity reached");
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
      headcountSince: this.now(),
      listeners: new Set(),
      emptySince: null,
      entranceEffects: [],
      coinDrops: [],
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
        if (room.community) session.capExempt = !!account.capExempt;
        return { participantSessionId, participantId: session.participant.participantId, room: this.snapshot(room) };
      }
    }
    if (room.community ? !this.hasUniversitySeat(roomId, account?.accountId ?? "", account?.capExempt)
      : room.capacity > 0 && room.sessions.size >= room.capacity) {
      throw new RoomError(409, "Room participant capacity reached");
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

  communityHeadcountSince(roomId: string): number {
    const room = this.requireRoom(roomId);
    if (!room.community) throw new RoomError(404, "Room not found");
    return room.headcountSince;
  }

  activeAccountIds(roomId: string): string[] {
    const now = this.now();
    const room = this.requireRoom(roomId);
    const active = new Set<string>();
    for (const session of room.sessions.values()) {
      if (session.accountId && now - session.lastSeenAt < SESSION_TIMEOUT_MS) active.add(session.accountId);
    }
    return [...active];
  }

  activeRoomIdsForAccount(accountId: string): string[] {
    const now = this.now();
    const roomIds: string[] = [];
    for (const room of this.rooms.values()) {
      if ([...room.sessions.values()].some(session => session.accountId === accountId
        && now - session.lastSeenAt < SESSION_TIMEOUT_MS)) roomIds.push(room.roomId);
    }
    return roomIds;
  }

  hasAccountParticipant(roomId: string, accountId: string): boolean {
    const room = this.requireRoom(roomId);
    return [...room.sessions.values()].some(session => session.accountId === accountId);
  }

  publishRoomEntranceEffect(
    roomId: string,
    accountId: string,
    effectId: RoomEntranceEffectEvent["effectId"],
    durationMs: number,
    custom?: { studioVersionId?: string; effectName?: string },
  ): RoomEntranceEffectEvent {
    const room = this.requireRoom(roomId);
    const participant = [...room.sessions.values()].find(session => session.accountId === accountId)?.participant;
    if (!participant) throw new RoomError(409, "The effect owner is no longer in the room");
    const tier = MONTHLY_CREDIT_BADGE_TIERS.find(item => item.entranceEffectId === effectId);
    const event: RoomEntranceEffectEvent = {
      eventId: randomUUID(),
      roomId: room.roomId,
      effectId,
      participantId: participant.participantId,
      displayName: participant.displayName,
      displayNameColor: participant.displayNameColor ?? "#FFFFFF",
      displayNameTierIndex: participant.displayNameTierIndex ?? 0,
      ...(tier ? { effectName: tier.name, badgeImage: tier.badgeImage, assetFolder: tier.entranceEffectFolder } : {}),
      ...(custom?.studioVersionId ? { studioVersionId: custom.studioVersionId } : {}),
      ...(custom?.effectName ? { effectName: custom.effectName } : {}),
      startedAt: this.now(),
      durationMs,
    };
    this.entranceEffectOwners.set(event.eventId, { roomId: room.roomId, accountId });
    room.entranceEffects = [...room.entranceEffects.filter(item => this.now() - item.startedAt < 60_000), event].slice(-20);
    const retained = new Set(room.entranceEffects.map(item => item.eventId));
    for (const [eventId, owner] of this.entranceEffectOwners) {
      if (owner.roomId === room.roomId && !retained.has(eventId)) this.entranceEffectOwners.delete(eventId);
    }
    this.emit(room, { type: "room.entrance-effect", data: event });
    return { ...event };
  }

  publishRoomCoinDrop(input: RoomCoinDropEvent): void {
    const room = this.requireRoom(input.roomId);
    const event = { ...input, roomId: room.roomId };
    room.coinDrops = [...room.coinDrops.filter(item => this.now() - item.startedAt < 60_000), event].slice(-20);
    this.emit(room, { type: "room.coin-drop", data: event });
  }

  recentRoomCoinDrops(roomId: string, maxAgeMs = 30_000): RoomCoinDropEvent[] {
    const room = this.requireRoom(roomId);
    return room.coinDrops.filter(item => this.now() - item.startedAt <= maxAgeMs).map(item => ({ ...item }));
  }

  publishHangoutStreakReward(roomId: string, accountId: string, day: string): void {
    const room = this.requireRoom(roomId);
    this.emit(room, { type: "room.hangout-streak-reward", data: {
      roomId: room.roomId, accountId, day, coins: 100,
    } });
  }

  entranceEffectOwnerAccountId(eventId: string): string | undefined {
    return this.entranceEffectOwners.get(eventId)?.accountId;
  }

  recentRoomEntranceEffects(roomId: string, maxAgeMs = 60_000): RoomEntranceEffectEvent[] {
    const room = this.requireRoom(roomId);
    const cutoff = this.now() - maxAgeMs;
    room.entranceEffects = room.entranceEffects.filter(item => item.startedAt >= cutoff);
    const retained = new Set(room.entranceEffects.map(item => item.eventId));
    for (const [eventId, owner] of this.entranceEffectOwners) {
      if (owner.roomId === room.roomId && !retained.has(eventId)) this.entranceEffectOwners.delete(eventId);
    }
    return room.entranceEffects.map(item => ({ ...item }));
  }

  /** Private incarnation identifier, never a reusable room-code history key. */
  getHistoryId(roomId: string): string {
    return this.requireRoom(roomId).historyId;
  }
  communityRoomIds(): string[] {
    return [...this.rooms.values()].filter(room => room.community).map(room => room.roomId);
  }
  hasAccountMember(roomId: string, accountId: string): boolean {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) return false;
    return [...room.sessions.values()].some(session => session.accountId === accountId);
  }
  publishKick(roomId: string, accountId: string, message: string): void {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) return;
    this.emit(room, { type: "room.kicked", data: { roomId: room.roomId, accountId, message } });
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
    room.headcountSince = this.now();
    if (room.sessions.size === 0) room.emptySince = this.now();
    this.broadcast(room);
  }

  /** Remove a current university member by public participant ID after host kick. */
  leaveParticipant(roomId: string, participantId: string): string | null {
    const room = this.requireRoom(roomId);
    for (const [sessionId, session] of room.sessions) {
      if (session.participant.participantId !== participantId) continue;
      room.sessions.delete(sessionId);
      room.headcountSince = this.now();
      if (room.sessions.size === 0) room.emptySince = this.now();
      this.broadcast(room);
      return session.accountId ?? null;
    }
    return null;
  }

  subscribe(roomId: string, listener: Listener): () => void {
    const room = this.requireRoom(roomId);
    if (room.listeners.size >= (room.community ? 2000 : 100)) {
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
  updateAccountIdentity(accountId: string, displayName: string, identity: EmojiIdentity, photoUrl?: string | null): void {
    for (const room of this.rooms.values()) {
      this.expire(room);
      let changed = false;
      for (const session of room.sessions.values()) {
        if (session.accountId !== accountId) continue;
        session.participant.displayName = displayName;
        session.participant.identity = { ...identity };
        if (photoUrl !== undefined) session.participant.photoUrl = room.community ? null : photoUrl;
        changed = true;
      }
      if (changed) this.broadcast(room);
    }
  }

  /** Update active room labels after a confirmed purchase or owner preview changes a name tier. */
  updateAccountNameColor(accountId: string, displayNameColor: string, displayNameTierIndex: number): void {
    for (const room of this.rooms.values()) {
      this.expire(room);
      let changed = false;
      for (const session of room.sessions.values()) {
        if (session.accountId !== accountId
          || (session.participant.displayNameColor === displayNameColor
            && session.participant.displayNameTierIndex === displayNameTierIndex)) continue;
        session.participant.displayNameColor = displayNameColor;
        session.participant.displayNameTierIndex = displayNameTierIndex;
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
    if (!room.hostParticipantId || (account && account.accountId === room.hostAccountId)) {
      room.hostParticipantId = participantId;
    }
    room.sessions.set(participantSessionId, {
      participant: {
        participantId,
        displayName,
        displayNameColor: account?.displayNameColor ?? "#FFFFFF",
        displayNameTierIndex: account?.displayNameTierIndex ?? 0,
        photoUrl: room.community ? null : account?.photoUrl ?? null,
        joinedAt: new Date(this.now()),
        identity: account ? { ...account.identity } : null,
        isRegistered: !!account,
        micEnabled: false,
        hostMuted: false,
        unmuteRequested: false,
      },
      lastSeenAt: this.now(),
      accountId: account?.accountId,
      capExempt: !!account?.capExempt,
    });
    room.headcountSince = this.now();
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
      room.headcountSince = now;
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
      throw new RoomError(401, "This room session does not belong to your account");
    }
    return copyParticipant(session.participant);
  }

  sessionAccountId(roomId: string, participantId: string): string | undefined {
    for (const session of this.requireRoom(roomId).sessions.values())
      if (session.participant.participantId === participantId) return session.accountId;
    return undefined;
  }

  accountSession(roomId: string, accountId: string): { sessionId: string; participantId: string } | null {
    for (const [sessionId, session] of this.requireRoom(roomId).sessions) {
      if (session.accountId === accountId)
        return { sessionId, participantId: session.participant.participantId };
    }
    return null;
  }

  publishChat(roomId: string, historyId: string, accepted: ChatAccepted, senderAccountId?: string): void {
    const room = this.rooms.get(roomId.toUpperCase());
    if (room?.historyId !== historyId) return;
    this.emit(room, { type: "chat.accepted", data: accepted, senderAccountId });
  }
}

export const roomStore = new RoomStore();
