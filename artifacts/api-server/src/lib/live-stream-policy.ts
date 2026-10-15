import { and, eq, isNull, or } from "drizzle-orm";
import { db, liveStreamSessions } from "@workspace/db";
import { liveStreamChatHub } from "./live-stream-chat";
import { liveKitBeamService } from "./livekit";
import { RoomError } from "./room-store";
import { isLiveStreamLeaseExpired, LIVE_STREAM_START_TTL_MS } from "./live-stream-session-policy";
import { createHash } from "node:crypto";

const startingAccounts = new Map<string, number>();

export function liveStreamIdForAccount(accountId: string): string {
  return createHashHex(accountId).slice(0, 32);
}

export function liveStreamRoomName(streamId: string): string {
  return `st-live-${streamId}`;
}

function createHashHex(value: string): string {
  // Node crypto is kept on the server; account IDs are never exposed as room names.
  return createHash("sha256").update(value).digest("hex");
}

export function isLiveStreamStarting(accountId: string): boolean {
  const until = startingAccounts.get(accountId) ?? 0;
  if (until > Date.now()) return true;
  if (until) startingAccounts.delete(accountId);
  return false;
}

export async function getLiveStreamSession(accountId: string) {
  const [session] = await db.select().from(liveStreamSessions)
    .where(eq(liveStreamSessions.accountId, accountId)).limit(1);
  return session;
}

export async function getLiveStreamSessionByStreamId(streamId: string) {
  const [session] = await db.select().from(liveStreamSessions)
    .where(eq(liveStreamSessions.streamId, streamId)).limit(1);
  return session;
}

export async function adoptLegacyLiveStreamSession(accountId: string, streamId: string): Promise<void> {
  const now = new Date();
  await db.insert(liveStreamSessions).values({
    accountId, streamId, state: "live", startedAt: now, lastHeartbeatAt: now, updatedAt: now,
  }).onConflictDoNothing();
}

export async function reserveLiveStreamStart(accountId: string, streamId: string): Promise<void> {
  if (isLiveStreamStarting(accountId)) {
    throw new RoomError(409, "A stream is already starting. Please wait a moment.");
  }
  const now = new Date();
  const [created] = await db.insert(liveStreamSessions).values({
    accountId, streamId, state: "starting", startedAt: now, lastHeartbeatAt: null, updatedAt: now,
  }).onConflictDoNothing().returning({ accountId: liveStreamSessions.accountId });
  if (!created) throw new RoomError(409, "Your stream may still be live on another device.");
  startingAccounts.set(accountId, Date.now() + LIVE_STREAM_START_TTL_MS);
}

export function clearLiveStreamStart(accountId: string): void {
  startingAccounts.delete(accountId);
}

export async function renewLiveStreamHeartbeat(accountId: string, streamId: string): Promise<boolean> {
  const now = new Date();
  const [updated] = await db.update(liveStreamSessions).set({
    state: "live", lastHeartbeatAt: now, updatedAt: now,
  }).where(and(
    eq(liveStreamSessions.accountId, accountId),
    eq(liveStreamSessions.streamId, streamId),
    // A final heartbeat cannot resurrect a session already being shut down.
    or(eq(liveStreamSessions.state, "live"), eq(liveStreamSessions.state, "starting")),
  )).returning({ accountId: liveStreamSessions.accountId });
  return Boolean(updated);
}

async function removeLiveKitRoom(streamId: string): Promise<void> {
  const roomName = liveStreamRoomName(streamId);
  const rooms = await liveKitBeamService.listRooms([roomName]);
  if (!rooms.some(room => room.name === roomName)) return;
  try {
    await liveKitBeamService.deleteRoom(roomName);
  } catch (failure) {
    // Two idempotent end requests can race; treat a confirmed missing room as ended.
    const after = await liveKitBeamService.listRooms([roomName]);
    if (after.some(room => room.name === roomName)) throw failure;
  }
}

export async function endLiveStreamSession(accountId: string, streamId: string): Promise<void> {
  clearLiveStreamStart(accountId);
  await db.update(liveStreamSessions).set({ state: "ending", updatedAt: new Date() })
    .where(and(eq(liveStreamSessions.accountId, accountId), eq(liveStreamSessions.streamId, streamId)));
  await removeLiveKitRoom(streamId);
  liveStreamChatHub.end(streamId);
  await db.delete(liveStreamSessions).where(and(
    eq(liveStreamSessions.accountId, accountId),
    eq(liveStreamSessions.streamId, streamId),
  ));
}

export async function cleanupStaleLiveStreamSession(session: typeof liveStreamSessions.$inferSelect): Promise<boolean> {
  const claimed = await db.update(liveStreamSessions).set({ state: "ending", updatedAt: new Date() })
    .where(and(
      eq(liveStreamSessions.accountId, session.accountId),
      eq(liveStreamSessions.streamId, session.streamId),
      eq(liveStreamSessions.state, session.state),
      eq(liveStreamSessions.startedAt, session.startedAt),
      eq(liveStreamSessions.updatedAt, session.updatedAt),
      session.lastHeartbeatAt
        ? eq(liveStreamSessions.lastHeartbeatAt, session.lastHeartbeatAt)
        : isNull(liveStreamSessions.lastHeartbeatAt),
    )).returning({ accountId: liveStreamSessions.accountId });
  if (!claimed.length) return false;
  await endLiveStreamSession(session.accountId, session.streamId);
  return true;
}

export async function liveStreamSessionIsFresh(
  session: typeof liveStreamSessions.$inferSelect,
  nowMs = Date.now(),
): Promise<boolean> {
  return !isLiveStreamLeaseExpired({
    state: session.state,
    startedAtMs: session.startedAt.getTime(),
    lastHeartbeatAtMs: session.lastHeartbeatAt?.getTime() ?? null,
    nowMs,
  });
}

export async function isLiveStreamActiveOrStarting(accountId: string): Promise<boolean> {
  if (isLiveStreamStarting(accountId)) return true;
  const session = await getLiveStreamSession(accountId);
  if (session) {
    if (await liveStreamSessionIsFresh(session)) return true;
    await cleanupStaleLiveStreamSession(session);
    return false;
  }
  const streamId = liveStreamIdForAccount(accountId);
  const participants = await liveKitBeamService.listParticipants(liveStreamRoomName(streamId));
  if (!participants.some(participant => participant.identity === "host")) return false;
  // One-time grace lease for streams that were already running when lease tracking
  // was introduced. Updated clients replace this timestamp with the host heartbeat.
  await adoptLegacyLiveStreamSession(accountId, streamId);
  return true;
}

export async function sweepStaleLiveStreamSessions(): Promise<number> {
  const sessions = await db.select().from(liveStreamSessions);
  let ended = 0;
  for (const session of sessions) {
    if (await liveStreamSessionIsFresh(session)) continue;
    if (await cleanupStaleLiveStreamSession(session)) ended++;
  }
  return ended;
}

export async function requireLiveStreamGiftAccess(senderId: string, recipientId: string, streamId: string): Promise<void> {
  const lease = await getLiveStreamSessionByStreamId(streamId);
  if (!lease || lease.state !== "live" || liveStreamIdForAccount(lease.accountId) !== streamId) {
    throw new RoomError(404, "This livestream is no longer available.");
  }
  if (!(await liveStreamSessionIsFresh(lease))) {
    await cleanupStaleLiveStreamSession(lease);
    throw new RoomError(404, "This livestream is no longer available.");
  }
  const participants = await liveKitBeamService.listParticipants(liveStreamRoomName(streamId));
  if (!participants.some(participant => participant.identity === "host")) {
    throw new RoomError(404, "This livestream is no longer available.");
  }
  const identityFor = (accountId: string) => accountId === lease.accountId
    ? "host"
    : `viewer-${liveStreamIdForAccount(accountId)}`;
  const activeIdentities = new Set(participants.map(participant => participant.identity));
  if (!activeIdentities.has(identityFor(senderId))) {
    throw new RoomError(403, "Join this livestream before sending a gift.");
  }
  if (!activeIdentities.has(identityFor(recipientId))) {
    throw new RoomError(403, "Choose someone who is currently in this livestream.");
  }
}
