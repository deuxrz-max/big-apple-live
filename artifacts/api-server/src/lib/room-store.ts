import { randomBytes, randomUUID } from "node:crypto";
import type { Participant, RoomSession, RoomState, EmojiIdentity, ChatAccepted, AccountRoomInput } from "@workspace/api-zod";

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
  | { type: "room.snapshot"; data: RoomState }
  | { type: "room.battle"; data: SocialRoomBattleSnapshot }
  | { type: "room.kicked"; data: { roomId: string; accountId: string; message: string } }
  | { type: "room.expired"; data: { roomId: string } };
type Listener = (event: RoomEvent) => void;
type ActiveSession = { participant: Participant; lastSeenAt: number; accountId?: string; capExempt?: boolean };
type AccountIdentity = { accountId: string; identity: EmojiIdentity; photoUrl?: string | null; capExempt?: boolean; displayNameColor?: string; displayNameTierIndex?: number };
export type SocialRoomBattleSnapshot = { version: number; playerIds: string[]; state: unknown };
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
  roomType: "legacy" | "topic" | "social";
  userCreated?: boolean;
  createdAt: Date;
  hostParticipantId: string;
  hostAccountId?: string;
  sessions: Map<string, ActiveSession>;
  /** Time when this room most recently reached its current participant count. */
  headcountSince: number;
  listeners: Set<Listener>;
  emptySince: number | null;
  battle: SocialRoomBattleSnapshot | null;
  community?: boolean;
  testOnly?: boolean;
  parentRoomId?: string | null;
};

/** Single-process, ephemeral presence store. Session credentials are never in snapshots. */
export class RoomStore {
  private readonly rooms = new Map<string, Room>();
  private communityEndListener: ((roomId: string) => void) | null = null;
  constructor(
    private readonly now: () => number = Date.now,
    private readonly allocateCode: (short: boolean) => string = short => randomBytes(short ? 3 : 6).toString("hex").toUpperCase(),
  ) {}
  setCommunityEndListener(listener: (roomId: string) => void): void {
    this.communityEndListener = listener;
  }

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
      name: input.label, capacity: 0, roomType: "topic", createdAt: input.createdAt, hostParticipantId: randomUUID(),
      sessions: new Map(), headcountSince: this.now(), listeners: new Set(), emptySince: null, battle: null, community: true, testOnly: input.testOnly,
       parentRoomId: input.parentRoomId });
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
    this.communityEndListener?.(room.roomId);
    this.rooms.delete(room.roomId);
  }
  /** Hide a community room without touching its persisted room or chat history. */
  deactivateCommunity(roomId: string): void {
    const id = roomId.toUpperCase();
    const room = this.rooms.get(id);
    if (!room?.community) return;
    this.emit(room, { type: "room.expired", data: { roomId: id } });
    room.listeners.clear();
    this.communityEndListener?.(room.roomId);
    this.rooms.delete(id);
  }
  isCommunity(roomId: string) { return !!this.rooms.get(roomId.toUpperCase())?.community; }
  isSocialRoom(roomId: string) { return this.rooms.get(roomId.toUpperCase())?.roomType === "social"; }
  socialRoomIds(): string[] {
    return [...this.rooms.values()].filter(room => room.roomType === "social").map(room => room.roomId);
  }
  hasRoomId(roomId: string) { return this.rooms.has(roomId.toUpperCase()); }
  hostAccountId(roomId: string): string | null {
    return this.rooms.get(roomId.toUpperCase())?.hostAccountId ?? null;
  }
  isTestOnly(roomId: string) { return !!this.rooms.get(roomId.toUpperCase())?.testOnly; }
  publicCommunityRoomIds(): string[] {
    return [...this.rooms.values()].filter(room => room.community && !room.testOnly && !room.userCreated).map(room => room.roomId);
  }
  /** Bots use this read-only list, never a participant session or a real seat. */
  occupiedUniversities() {
    const now = this.now();
    return [...this.rooms.values()].filter(room => room.community && !room.testOnly && !room.userCreated
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
      roomType: "legacy",
      createdAt: new Date(this.now()),
      hostParticipantId: "",
      hostAccountId: account?.accountId,
      sessions: new Map(),
      headcountSince: this.now(),
      listeners: new Set(),
      battle: null,
       emptySince: null,
    };
    this.rooms.set(roomId, room);
    return this.addSession(room, displayName, account);
  }

  createSocialRoom(
    roomId: string,
    historyId: string,
    name: string,
    displayName: string,
    account: AccountIdentity,
  ): RoomSession {
    this.sweep();
    if (this.rooms.size >= 10_000) throw new RoomError(503, "Room service capacity reached");
    const id = roomId.toUpperCase();
    if (this.rooms.has(id)) throw new RoomError(409, "That room code is already active");
    const room: Room = {
      roomId: id,
      historyId,
      name,
      capacity: 0,
      roomType: "social",
      userCreated: true,
      createdAt: new Date(this.now()),
      hostParticipantId: "",
      hostAccountId: account.accountId,
      sessions: new Map(),
      headcountSince: this.now(),
      listeners: new Set(),
      battle: null,
      emptySince: null,
       community: true,
    };
    this.rooms.set(id, room);
    return this.addSession(room, displayName, account);
  }

  discardSocialRoom(roomId: string): void {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room?.userCreated) return;
    this.emit(room, { type: "room.expired", data: { roomId: room.roomId } });
    room.listeners.clear();
    this.communityEndListener?.(room.roomId);
    this.rooms.delete(room.roomId);
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
      if (session.accountId !== accountId) continue;
      session.participant.participantId = participantId;
      if (accountId === room.hostAccountId) room.hostParticipantId = participantId;
    }
    this.broadcast(room);
  }

  get(roomId: string): RoomState {
    return this.snapshot(this.requireRoom(roomId));
  }

  getSocialRoomBattle(roomId: string): SocialRoomBattleSnapshot | null {
    const room = this.requireSocialRoom(roomId);
    return room.battle ? this.copyBattle(room.battle) : null;
  }

  startSocialRoomBattle(roomId: string, startedByAccountId: string, playerIds: string[], state: unknown): SocialRoomBattleSnapshot {
    const room = this.requireSocialRoom(roomId);
    if (!playerIds.length || playerIds.length > 4 || new Set(playerIds).size !== playerIds.length) {
      throw new RoomError(400, "A room battle needs one to four seated players.");
    }
    if (!playerIds.some(participantId => this.sessionAccountId(roomId, participantId) === startedByAccountId)) {
      throw new RoomError(403, "Take a seat before starting the game.");
    }
    if (room.battle && !this.battleIsOver(room.battle.state)) {
      if (!room.battle.playerIds.some(participantId => this.sessionAccountId(roomId, participantId) === startedByAccountId)) {
        throw new RoomError(403, "This game already started with a different group of seated players.");
      }
      return this.copyBattle(room.battle);
    }
    this.assertBattleTeams(state, playerIds);
    room.battle = { version: 1, playerIds: [...playerIds], state: this.copyJson(state) };
    const snapshot = this.copyBattle(room.battle);
    this.emit(room, { type: "room.battle", data: snapshot });
    return snapshot;
  }

  commitSocialRoomBattle(roomId: string, expectedVersion: number, actorAccountId: string, state: unknown): SocialRoomBattleSnapshot {
    const room = this.requireSocialRoom(roomId);
    const current = room.battle;
    if (!current) throw new RoomError(404, "This room has no active game.");
    if (current.version !== expectedVersion) throw new RoomError(409, "The game changed. Syncing the latest turn.");
    if (this.battleIsOver(current.state)) throw new RoomError(409, "This game has ended.");
    if (!current.playerIds.some(participantId => this.sessionAccountId(roomId, participantId) === actorAccountId)) {
      throw new RoomError(403, "Only players who started this game can take part.");
    }

    const before = this.battleRecord(current.state);
    const after = this.battleRecord(state);
    const beforeSide = before.turnSide;
    if (beforeSide === "humans") {
      const activeHero = (before.teams.humans as Record<string, unknown>[])[Number(before.activeIndex.humans)];
      const activeParticipantId = activeHero?.participantId;
      if (typeof activeParticipantId !== "string"
        || this.sessionAccountId(roomId, activeParticipantId) !== actorAccountId) {
        throw new RoomError(403, "It is another player's turn.");
      }
    }
    const expectedSide = beforeSide === "humans" ? "bots" : "humans";
    if (after.turnSide !== expectedSide || Number(after.turnNumber) !== Number(before.turnNumber) + 1) {
      throw new RoomError(400, "Submit exactly one completed turn.");
    }
    this.assertBattleTeams(state, current.playerIds);
    const snapshot = {
      version: current.version + 1,
      playerIds: [...current.playerIds],
      state: this.copyJson(state),
    };
    room.battle = snapshot;
    this.emit(room, { type: "room.battle", data: this.copyBattle(snapshot) });
    return this.copyBattle(snapshot);
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

  private requireSocialRoom(roomId: string): Room {
    const room = this.requireRoom(roomId);
    if (room.roomType !== "social") throw new RoomError(404, "Room game is only available in user-created social rooms.");
    return room;
  }

  private battleRecord(value: unknown): Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new RoomError(400, "Invalid game state.");
    const state = value as Record<string, any>;
    if (!state.teams || !Array.isArray(state.teams.humans) || !Array.isArray(state.teams.bots)
      || !state.activeIndex || !["humans", "bots"].includes(state.turnSide)
      || !Number.isInteger(state.turnNumber)) {
      throw new RoomError(400, "Invalid game state.");
    }
    return state;
  }

  private assertBattleTeams(value: unknown, playerIds: string[]): void {
    const state = this.battleRecord(value);
    const humans = state.teams.humans as Record<string, unknown>[];
    const bots = state.teams.bots as Record<string, unknown>[];
    if (humans.length !== playerIds.length || bots.length !== playerIds.length) {
      throw new RoomError(400, "The two teams must have the same number of players.");
    }
    if (humans.some((hero, index) => hero.participantId !== playerIds[index])
      || bots.some(boss => !["vampire", "wolf", "ghost", "zombie", "dragon"].includes(String(boss.bossId)))) {
      throw new RoomError(400, "The game teams do not match the seated players and available bosses.");
    }
  }

  private battleIsOver(value: unknown): boolean {
    try {
      const outcome = this.battleRecord(value).outcome;
      return outcome === "victory" || outcome === "defeat";
    } catch { return false; }
  }

  private copyJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private copyBattle(battle: SocialRoomBattleSnapshot): SocialRoomBattleSnapshot {
    return { ...battle, playerIds: [...battle.playerIds], state: this.copyJson(battle.state) };
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
    if ((!room.community || room.userCreated) && room.emptySince !== null && now - room.emptySince >= EMPTY_ROOM_TIMEOUT_MS) {
      if (room.userCreated) this.communityEndListener?.(room.roomId);
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
      roomType: room.roomType,
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
