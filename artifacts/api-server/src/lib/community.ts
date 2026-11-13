import { randomUUID, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, accountProfiles, chatRooms, chatAdmissions, chatModerators, chatMemberships } from "@workspace/db";
import { RoomError, roomStore } from "./room-store";
import {
  COMMUNITY_ROOMS,
  DIRECTORY_COMMUNITY_ROOM_IDS,
  DIRECTORY_COMMUNITY_ROOMS,
} from "./community-config";
import { isOwnerAccount } from "./social/owner-access-policy";
export { COMMUNITY_ROOMS } from "./community-config";
export async function initializeCommunities() {
  for (const entry of COMMUNITY_ROOMS) {
    await db.insert(chatRooms).values({
      roomId: entry.roomId,
      label: entry.label,
      historyId: randomUUID(),
    }).onConflictDoNothing();
    await db.update(chatRooms).set({ label: entry.label }).where(eq(chatRooms.roomId, entry.roomId));
  }
  for (const entry of COMMUNITY_ROOMS) {
    const overflowRooms = await db.select({ roomId: chatRooms.roomId, overflowNumber: chatRooms.overflowNumber })
      .from(chatRooms).where(eq(chatRooms.parentRoomId, entry.roomId));
    for (const overflow of overflowRooms) {
      const number = overflow.overflowNumber;
      if (!number) continue;
      await db.update(chatRooms).set({ label: `${entry.label} ${number}` })
        .where(eq(chatRooms.roomId, overflow.roomId));
    }
  }
  const activeRoomIds = new Set<string>(DIRECTORY_COMMUNITY_ROOM_IDS);
  const savedRooms = await db.select().from(chatRooms);
  // Deactivate hidden rooms in memory while preserving their database rows, settings, histories and pools.
  for (const saved of savedRooms) {
    const activeOverflow = saved.parentRoomId && activeRoomIds.has(saved.parentRoomId);
    if (activeRoomIds.has(saved.roomId) || activeOverflow) {
      roomStore.registerCommunity(saved);
    } else if (roomStore.isCommunity(saved.roomId)) {
      roomStore.deactivateCommunity(saved.roomId);
    }
  }
}
export async function communityDirectory() {
  const savedRooms = await db.select().from(chatRooms);
  const activeRoomIds = new Set<string>(DIRECTORY_COMMUNITY_ROOM_IDS);
  const overflow = savedRooms.filter(room =>
    room.parentRoomId
    && activeRoomIds.has(room.parentRoomId)
    && roomStore.isCommunity(room.roomId)
    && roomStore.get(room.roomId).participants.length > 0);
  return DIRECTORY_COMMUNITY_ROOM_IDS.flatMap(roomId => {
    const base = DIRECTORY_COMMUNITY_ROOMS.find(room => room.roomId === roomId);
    if (!base) return [];
    const children = overflow.filter(room => room.parentRoomId === roomId)
      .sort((a, b) => Number(a.overflowNumber) - Number(b.overflowNumber));
    return [base, ...children].map(room => ({
      roomId: room.roomId,
      label: room.label,
      headcount: roomStore.get(room.roomId).participants.length,
      headcountSince: roomStore.communityHeadcountSince(room.roomId),
      // The generated client still consumes this legacy response shape; no video playback is active.
      nowPlayingVideoId: null,
      nowPlayingTitle: null,
      nowPlayingStartedAtMs: null,
    }));
  });
}
/** Stable identifiers and history rows survive empty rooms/restarts. No history is reused. */
export async function offerOverflow(roomId: string, accountId: string) {
  const [current] = await db.select().from(chatRooms).where(eq(chatRooms.roomId, roomId.toUpperCase()));
  if (!current) throw new RoomError(404, "Room not found");
  const parent = current.parentRoomId ?? current.roomId;
  const base = DIRECTORY_COMMUNITY_ROOMS.find(r => r.roomId === parent);
  if (!base) throw new RoomError(404, "Room not found");
  let number = Number(current.overflowNumber ?? 1) + 1;
  for (;;) {
    const id = createHash("sha256").update(`university:${parent}:${number}`).digest("hex").slice(0, 12).toUpperCase();
    const [existing] = await db.select().from(chatRooms).where(eq(chatRooms.roomId, id));
    if (!existing) await db.insert(chatRooms).values({
      roomId: id, label: `${base.label} ${number}`, parentRoomId: parent,
      overflowNumber: String(number), historyId: randomUUID(),
    }).onConflictDoNothing();
    const [saved] = await db.select().from(chatRooms).where(eq(chatRooms.roomId, id));
    roomStore.registerCommunity(saved!);
    if (roomStore.hasUniversitySeat(id, accountId)) return { roomId: id, label: saved!.label };
    number++;
  }
}
export async function accessFor(accountId: string) {
  const [[admission], [moderator], [profile]] = await Promise.all([
    db.select().from(chatAdmissions).where(eq(chatAdmissions.accountId, accountId)),
    db.select().from(chatModerators).where(eq(chatModerators.accountId, accountId)),
    db.select({ username: accountProfiles.username, isTestAccount: accountProfiles.isTestAccount })
      .from(accountProfiles).where(eq(accountProfiles.accountId, accountId)),
  ]);
  return { adultConfirmed: !!admission && !admission.suspended, suspended: !!admission?.suspended,
    moderator: !!moderator, owner: profile ? isOwnerAccount(profile) : false,
    chatMuted: !!admission?.chatMuted, reportsMuted: !!admission?.reportsMuted,
    warning: admission?.warningAt && Date.now() - admission.warningAt.getTime() < 24 * 60 * 60_000
      ? admission.moderationWarning?.replace(/stream ?talk/gi, "Big Apple Live") ?? null : null };
}
export async function requireAdult(accountId: string) {
  if (!(await accessFor(accountId)).adultConfirmed)
    throw new RoomError(403, "Big Apple Live is adults-only. Confirm that you are 18 or older before entering chat.");
}
export async function requireModerator(accountId: string) {
  await requireAdult(accountId);
  if (!(await accessFor(accountId)).moderator) throw new RoomError(403, "Moderator access required");
}
export async function requireOwner(accountId: string) {
  const [profile] = await db.select({
    username: accountProfiles.username,
    isTestAccount: accountProfiles.isTestAccount,
  }).from(accountProfiles).where(eq(accountProfiles.accountId, accountId));
  if (!profile || !isOwnerAccount(profile)) throw new RoomError(403, "Owner access required");
}
export async function communityMembership(roomId: string, accountId: string) {
  const historyId = roomStore.getHistoryId(roomId);
  await db.insert(chatMemberships).values({ historyId, accountId }).onConflictDoNothing();
  const [membership] = await db.select().from(chatMemberships)
    .where(and(eq(chatMemberships.historyId, historyId), eq(chatMemberships.accountId, accountId)));
  return membership!;
}
