import { randomUUID, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, chatRooms, chatAdmissions, chatModerators, chatMemberships } from "@workspace/db";
import { RoomError, roomStore } from "./room-store";
import { COMMUNITY_ROOMS } from "./community-config";
export { COMMUNITY_ROOMS, communityDefaultVideoSearch } from "./community-config";
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
  for (const entry of COMMUNITY_ROOMS) {
    const [saved] = await db.select().from(chatRooms).where(eq(chatRooms.roomId, entry.roomId));
    roomStore.registerCommunity(saved!);
  }
  for (const saved of await db.select().from(chatRooms)) roomStore.registerCommunity(saved);
}
export async function communityDirectory() {
  const savedRooms = await db.select().from(chatRooms);
  const overflow = savedRooms.filter(r =>
    r.parentRoomId && roomStore.isCommunity(r.roomId) && roomStore.get(r.roomId).participants.length > 0);
  const baseIds = new Set(COMMUNITY_ROOMS.map(room => room.roomId));
  const extraRoots = savedRooms.filter(room => !room.parentRoomId && !baseIds.has(room.roomId));
  const extraRootIds = new Set(extraRoots.map(room => room.roomId));
  const otherOverflow = overflow.filter(room => room.parentRoomId && !baseIds.has(room.parentRoomId) && !extraRootIds.has(room.parentRoomId));
  return [
    ...COMMUNITY_ROOMS.flatMap(base => [
      { roomId: base.roomId, label: base.label },
      ...overflow.filter(r => r.parentRoomId === base.roomId)
      .sort((a, b) => Number(a.overflowNumber) - Number(b.overflowNumber))
      .map(r => ({ roomId: r.roomId, label: r.label })),
    ]),
    ...extraRoots.flatMap(root => [
      { roomId: root.roomId, label: root.label },
      ...overflow.filter(room => room.parentRoomId === root.roomId)
        .sort((a, b) => Number(a.overflowNumber) - Number(b.overflowNumber))
        .map(room => ({ roomId: room.roomId, label: room.label })),
    ]),
    ...otherOverflow.map(room => ({ roomId: room.roomId, label: room.label })),
  ].map(r => ({ ...r, headcount: roomStore.get(r.roomId).participants.length }));
}
/** Stable identifiers and history rows survive empty rooms/restarts. No history is reused. */
export async function offerOverflow(roomId: string, accountId: string) {
  const [current] = await db.select().from(chatRooms).where(eq(chatRooms.roomId, roomId.toUpperCase()));
  if (!current) throw new RoomError(404, "University not found");
  const parent = current.parentRoomId ?? current.roomId;
  const base = COMMUNITY_ROOMS.find(r => r.roomId === parent);
  if (!base) throw new RoomError(404, "University not found");
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
  const [admission] = await db.select().from(chatAdmissions).where(eq(chatAdmissions.accountId, accountId));
  const [moderator] = await db.select().from(chatModerators).where(eq(chatModerators.accountId, accountId));
  return { adultConfirmed: !!admission && !admission.suspended, suspended: !!admission?.suspended,
    moderator: !!moderator };
}
export async function requireAdult(accountId: string) {
  if (!(await accessFor(accountId)).adultConfirmed)
    throw new RoomError(403, "Streamtalk is adults-only. Confirm that you are 18 or older before entering chat.");
}
export async function requireModerator(accountId: string) {
  await requireAdult(accountId);
  if (!(await accessFor(accountId)).moderator) throw new RoomError(403, "Moderator access required");
}
export async function communityMembership(roomId: string, accountId: string) {
  const historyId = roomStore.getHistoryId(roomId);
  await db.insert(chatMemberships).values({ historyId, accountId }).onConflictDoNothing();
  const [membership] = await db.select().from(chatMemberships)
    .where(and(eq(chatMemberships.historyId, historyId), eq(chatMemberships.accountId, accountId)));
  return membership!;
}
