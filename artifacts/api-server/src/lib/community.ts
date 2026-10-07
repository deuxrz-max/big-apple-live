import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, chatRooms, chatAdmissions, chatModerators, chatMemberships, roomMessages } from "@workspace/db";
import { RoomError, roomStore } from "./room-store";
import { atmosphereConfig } from "./community-atmosphere";

export const COMMUNITY_ROOMS = [
  { roomId: "LIVEME", label: "LiveMe" }, { roomId: "BIGOLV", label: "Bigo Live" },
  { roomId: "TANGOL", label: "Tango Live" }, { roomId: "TIKTOK", label: "TikTok" },
  { roomId: "INSTAL", label: "Instagram Live" },
  { roomId: "SUPRLV", label: "Super Live" },
];
export async function initializeCommunities() {
  for (const entry of COMMUNITY_ROOMS) {
    await db.insert(chatRooms).values({ ...entry, historyId: randomUUID() }).onConflictDoNothing();
    const [saved] = await db.select().from(chatRooms).where(eq(chatRooms.roomId, entry.roomId));
    roomStore.registerCommunity(saved!);
  }
  await tickCommunities();
}
export async function accessFor(accountId: string) {
  const [admission] = await db.select().from(chatAdmissions).where(eq(chatAdmissions.accountId, accountId));
  const [moderator] = await db.select().from(chatModerators).where(eq(chatModerators.accountId, accountId));
  return { adultConfirmed: !!admission && !admission.suspended, suspended: !!admission?.suspended,
    moderator: !!moderator, sentimentEnabled: false };
}
export async function requireAdult(accountId: string) {
  if (!(await accessFor(accountId)).adultConfirmed)
    throw new RoomError(403, "We Buggin is adults-only. Confirm that you are 18 or older before entering chat.");
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
let ticking = false;
export async function tickCommunities() {
  if (ticking) return;
  ticking = true;
  try {
    for (const entry of COMMUNITY_ROOMS) {
      const tracker = roomStore.communityAtmosphere(entry.roomId);
      if (!tracker) continue;
      const [activity] = await db.select({
        count: sql<number>`count(*)::int`,
        authors: sql<number>`count(distinct ${roomMessages.authorAccountId})::int`,
      }).from(roomMessages).where(and(
        eq(roomMessages.historyId, roomStore.getHistoryId(entry.roomId)),
        eq(roomMessages.hidden, "false"),
        gte(roomMessages.createdAt, new Date(Date.now() - atmosphereConfig.windowMs)),
      ));
      const previous = tracker.current();
      // Deliberately no sentiment classifier/API: activity is not hostility.
      const current = tracker.evaluate(activity ?? { count: 0, authors: 0 });
      if (current.scene !== previous.scene) await db.update(chatRooms)
        .set({ atmosphere: { scene: current.scene, since: current.since } })
        .where(eq(chatRooms.roomId, entry.roomId));
      roomStore.publishCommunityAtmosphere(entry.roomId);
    }
  } finally { ticking = false; }
}
