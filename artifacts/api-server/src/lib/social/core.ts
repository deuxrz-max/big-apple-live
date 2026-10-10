import { db, accountProfiles, socialSettings, socialWallets, socialRelations, socialInventory, socialLedger, socialMessages } from "@workspace/db";
import { and, eq, or, sql } from "drizzle-orm";
import { RoomError } from "../room-store";
import { publicProfile } from "../account-profiles";
import { DAILY_REWARD } from "./catalog";
import { visibleProfilePhotos } from "../photo-visibility";
import { TIMED_BADGES } from './marathon-policy';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ProfileRow = typeof accountProfiles.$inferSelect;
export type SettingsRow = typeof socialSettings.$inferSelect;
export async function requireAccount(id: string) {
  const [profile] = await db.select().from(accountProfiles).where(eq(accountProfiles.accountId, id));
  if (!profile || (process.env.NODE_ENV === "production" && profile.isTestAccount))
    throw new RoomError(409, "Set up your profile in Edit profile first");
  return profile;
}
export async function targetAccount(username: string) {
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) throw new RoomError(400, "Invalid dedicated name");
  const [profile] = await db.select().from(accountProfiles).where(eq(accountProfiles.nameKey, username.toLowerCase()));
  if (!profile || (process.env.NODE_ENV === "production" && profile.isTestAccount))
    throw new RoomError(404, "This person is not available");
  return profile;
}
export async function ensureSocial(id: string, tx: Tx | typeof db = db) {
  await tx.insert(socialSettings).values({ accountId: id }).onConflictDoNothing();
  await tx.insert(socialWallets).values({ accountId: id }).onConflictDoNothing();
}
export async function lockAccounts(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"social-wallet:" + id}, 0))`);
    await ensureSocial(id, tx);
  }
}
export async function lockPair(tx: Tx, a: string, b: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"social-pair:" + [a, b].sort().join(":")}, 0))`);
}
export async function pairBlocked(a: string, b: string, tx: Tx | typeof db = db) {
  const rows = await tx.select().from(socialRelations).where(and(eq(socialRelations.kind, "block"), or(
    and(eq(socialRelations.ownerId, a), eq(socialRelations.targetId, b)),
    and(eq(socialRelations.ownerId, b), eq(socialRelations.targetId, a)),
  ))).limit(1);
  return rows.length > 0;
}
export async function assertContact(tx: Tx | typeof db, actor: string, target: string) {
  if (actor === target) throw new RoomError(400, "Choose another person");
  if (await pairBlocked(actor, target, tx)) throw new RoomError(403, "This interaction is not available while either person has blocked the other");
  const [settings] = await tx.select().from(socialSettings).where(eq(socialSettings.accountId, target));
  if (!settings) throw new RoomError(404, "This person has not joined the community");
  if (!settings.discoverable) {
    const [conversation] = await tx.select({ id: socialMessages.id }).from(socialMessages).where(or(
      and(eq(socialMessages.senderId, actor), eq(socialMessages.recipientId, target)),
      and(eq(socialMessages.senderId, target), eq(socialMessages.recipientId, actor)),
    )).limit(1);
    const [favorite] = await tx.select().from(socialRelations).where(and(
      eq(socialRelations.ownerId, actor), eq(socialRelations.targetId, target), eq(socialRelations.kind, "favorite"),
    )).limit(1);
    if (!conversation && !favorite) throw new RoomError(404, "This person is not available in discovery");
  }
}
export async function person(viewer: string, profile: ProfileRow, settings?: SettingsRow | null, includeStats = false) {
  const id = profile.accountId;
  const [prefs] = settings ? [settings] : await db.select().from(socialSettings).where(eq(socialSettings.accountId, id));
  const [wallet] = await db.select().from(socialWallets).where(eq(socialWallets.accountId, id));
  const [favorite] = await db.select().from(socialRelations).where(and(eq(socialRelations.ownerId, viewer), eq(socialRelations.targetId, id), eq(socialRelations.kind, "favorite")));
  const blocked = id !== viewer && await pairBlocked(viewer, id);
  const photos = blocked ? { photoUrl: null, photoUrls: [] } : await visibleProfilePhotos(id, viewer, profile);
  // Detail pages only: do not add per-person aggregate queries to discovery lists.
  const [counts] = includeStats ? await db.select({
    followerCount: sql<number>`count(*) filter (where ${socialRelations.targetId} = ${id})::int`,
    followingCount: sql<number>`count(*) filter (where ${socialRelations.ownerId} = ${id})::int`,
  }).from(socialRelations).where(and(eq(socialRelations.kind, "favorite"), or(
    eq(socialRelations.ownerId, id), eq(socialRelations.targetId, id),
  ))) : [];
  const badges = includeStats && !blocked ? await db.select({
    id: socialInventory.itemId, acquired: socialInventory.purchasedAt,
  }).from(socialInventory).where(and(eq(socialInventory.accountId, id),
    sql`(${socialInventory.expiresAt} IS NULL OR ${socialInventory.expiresAt} > CURRENT_TIMESTAMP)`)) : [];
  const timedSelected = TIMED_BADGES.some(b => b.id === prefs?.badgeId);
  const [activeSelected] = timedSelected && prefs?.badgeId ? await db.select({ id: socialInventory.itemId })
    .from(socialInventory).where(and(eq(socialInventory.accountId, id), eq(socialInventory.itemId, prefs.badgeId),
      sql`(${socialInventory.expiresAt} IS NULL OR ${socialInventory.expiresAt} > CURRENT_TIMESTAMP)`)) : [];
  return {
    username: profile.username, displayName: profile.displayName ?? profile.username,
    ...photos, identity: publicProfile(profile).identity,
    bio: blocked ? "" : prefs?.bio ?? "", country: blocked ? null : prefs?.country ?? null,
    externalPlatform: blocked ? null : prefs?.externalPlatform ?? null,
    externalHandle: blocked ? null : prefs?.externalHandle ?? null,
    interests: blocked ? [] : prefs?.interests ?? [], discoverable: prefs?.discoverable ?? false,
    favorite: !!favorite, blocked, receivedCredits: wallet?.received ?? 0, badgeId: timedSelected && !activeSelected ? null : prefs?.badgeId ?? null,
    ...(includeStats ? {
      followerCount: counts?.followerCount ?? 0, followingCount: counts?.followingCount ?? 0,
      sentCredits: wallet?.sent ?? 0,
      badges: badges.map(b => ({ id: b.id, earnedAt: b.acquired.toISOString() })),
    } : {}),
  };
}
export async function wallet(id: string, tx: Tx | typeof db = db) {
  const [row] = await tx.select().from(socialWallets).where(eq(socialWallets.accountId, id));
  if (!row) throw new RoomError(409, "Open Rewards to initialize your wallet");
  return { balance: row.balance, earned: row.earned, received: row.received, sent: row.sent,
    canClaimDaily: row.lastClaimDay !== new Date().toISOString().slice(0, 10), dailyReward: DAILY_REWARD };
}
export async function replay(tx: Tx, id: string, key: string, ref: string) {
  const [row] = await tx.select().from(socialLedger).where(and(eq(socialLedger.accountId, id), eq(socialLedger.requestKey, key)));
  if (!row) return false;
  if (row.refKey !== ref) throw new RoomError(409, "This retry key belongs to a different action");
  return true;
}
export const socialTables = { socialInventory };
