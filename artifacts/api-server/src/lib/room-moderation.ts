import { and, eq } from "drizzle-orm";
import { accountProfiles, chatModerators, db, hostRoomBlocks, roomSessionKicks } from "@workspace/db";
import { RoomError, roomStore } from "./room-store";

export type RoomScope = {
  type: "community" | "livestream";
  key: string;
  hostAccountId?: string;
};

export const ROOM_KICK_MESSAGE = "You've been removed from the room";

export function communityRoomScope(roomId: string): RoomScope {
  if (!roomStore.isCommunity(roomId)) throw new RoomError(404, "Room not found.");
  return { type: "community", key: roomStore.getHistoryId(roomId) };
}

export function liveStreamScope(streamId: string, startedAt: Date, hostAccountId?: string): RoomScope {
  return { type: "livestream", key: `${streamId}:${startedAt.getTime()}`, hostAccountId };
}

export async function assertRoomAccessAllowed(scope: RoomScope, accountId: string): Promise<void> {
  if (scope.hostAccountId && scope.hostAccountId !== accountId) {
    const [blocked] = await db.select({ hostAccountId: hostRoomBlocks.hostAccountId })
      .from(hostRoomBlocks).where(and(
        eq(hostRoomBlocks.hostAccountId, scope.hostAccountId),
        eq(hostRoomBlocks.targetAccountId, accountId),
      )).limit(1);
    if (blocked) throw new RoomError(403, "This host has blocked your access to their rooms.");
  }

  const [kick] = await db.select({ targetAccountId: roomSessionKicks.targetAccountId })
    .from(roomSessionKicks).where(and(
      eq(roomSessionKicks.scopeType, scope.type),
      eq(roomSessionKicks.scopeKey, scope.key),
      eq(roomSessionKicks.targetAccountId, accountId),
    )).limit(1);
  if (kick) throw new RoomError(409, ROOM_KICK_MESSAGE);
}

export async function saveRoomKick(scope: RoomScope, actorAccountId: string, targetAccountId: string): Promise<void> {
  if (actorAccountId === targetAccountId) throw new RoomError(400, "You cannot remove yourself from the room.");
  await db.insert(roomSessionKicks).values({
    scopeType: scope.type, scopeKey: scope.key, actorAccountId, targetAccountId,
  }).onConflictDoNothing();
}

export async function isExistingModerator(accountId: string): Promise<boolean> {
  const [row] = await db.select({ accountId: chatModerators.accountId })
    .from(chatModerators).where(eq(chatModerators.accountId, accountId)).limit(1);
  return !!row;
}

export async function assertHostOrModerator(hostAccountId: string, actorAccountId: string): Promise<void> {
  if (hostAccountId !== actorAccountId && !(await isExistingModerator(actorAccountId))) {
    throw new RoomError(403, "Only this room's host or an existing moderator can do that.");
  }
}

export async function setHostRoomBlock(hostAccountId: string, targetAccountId: string, active: boolean): Promise<void> {
  if (hostAccountId === targetAccountId) throw new RoomError(400, "You cannot block yourself from your own rooms.");
  const [target] = await db.select({ accountId: accountProfiles.accountId })
    .from(accountProfiles).where(eq(accountProfiles.accountId, targetAccountId)).limit(1);
  if (!target) throw new RoomError(404, "This person is not available.");
  if (active) {
    await db.insert(hostRoomBlocks).values({ hostAccountId, targetAccountId }).onConflictDoNothing();
  } else {
    await db.delete(hostRoomBlocks).where(and(
      eq(hostRoomBlocks.hostAccountId, hostAccountId),
      eq(hostRoomBlocks.targetAccountId, targetAccountId),
    ));
  }
}

export async function listHostRoomBlocks(hostAccountId: string) {
  const rows = await db.select({
    accountId: hostRoomBlocks.targetAccountId,
    username: accountProfiles.username,
    createdAt: hostRoomBlocks.createdAt,
  }).from(hostRoomBlocks)
    .innerJoin(accountProfiles, eq(accountProfiles.accountId, hostRoomBlocks.targetAccountId))
    .where(eq(hostRoomBlocks.hostAccountId, hostAccountId))
    .orderBy(hostRoomBlocks.createdAt);
  return rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export function publishRoomKick(roomId: string, targetAccountId: string): void {
  roomStore.publishKick(roomId, targetAccountId, ROOM_KICK_MESSAGE);
}
