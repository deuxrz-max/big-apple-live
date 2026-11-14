import { db, accountProfiles, socialSettings, socialRelations } from '@workspace/db';
import { and, eq, or, sql } from 'drizzle-orm';
import { RoomError } from '../room-store';
import { publicProfile } from '../account-profiles';
import { visibleProfilePhotos } from '../photo-visibility';
import { getProfileCosmeticStyle } from './profile-cosmetics';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ProfileRow = typeof accountProfiles.$inferSelect;
export type SettingsRow = typeof socialSettings.$inferSelect;

export async function requireAccount(id: string) {
  const [profile] = await db.select().from(accountProfiles).where(eq(accountProfiles.accountId, id));
  if (!profile || (process.env.NODE_ENV === 'production' && profile.isTestAccount))
    throw new RoomError(409, 'Set up your profile in Edit profile first');
  return profile;
}

export async function targetAccount(username: string) {
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) throw new RoomError(400, 'Invalid dedicated name');
  const [profile] = await db.select().from(accountProfiles).where(eq(accountProfiles.nameKey, username.toLowerCase()));
  if (!profile || (process.env.NODE_ENV === 'production' && profile.isTestAccount))
    throw new RoomError(404, 'This person is not available');
  return profile;
}

export async function ensureSocial(id: string, tx: Tx | typeof db = db) {
  await tx.insert(socialSettings).values({ accountId: id }).onConflictDoNothing();
}

export async function lockAccounts(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'social-profile:' + id}, 0))`);
    await ensureSocial(id, tx);
  }
}

export async function lockPair(tx: Tx, a: string, b: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'social-pair:' + [a, b].sort().join(':')}, 0))`);
}

export async function pairBlocked(a: string, b: string, tx: Tx | typeof db = db) {
  const rows = await tx.select().from(socialRelations).where(and(eq(socialRelations.kind, 'block'), or(
    and(eq(socialRelations.ownerId, a), eq(socialRelations.targetId, b)),
    and(eq(socialRelations.ownerId, b), eq(socialRelations.targetId, a)),
  ))).limit(1);
  return rows.length > 0;
}

export async function assertContact(tx: Tx | typeof db, actor: string, target: string) {
  if (actor === target) throw new RoomError(400, 'Choose another person');
  if (await pairBlocked(actor, target, tx))
    throw new RoomError(403, 'This interaction is not available while either person has blocked the other');
  const [settings] = await tx.select({ accountId: socialSettings.accountId }).from(socialSettings)
    .where(eq(socialSettings.accountId, target));
  if (!settings) throw new RoomError(404, 'This person has not joined the community');
}

export async function person(viewer: string, profile: ProfileRow, settings?: SettingsRow | null, includeStats = false) {
  const id = profile.accountId;
  const [prefs] = settings ? [settings] : await db.select().from(socialSettings).where(eq(socialSettings.accountId, id));
  const favoriteRows = await db.select({ id: socialRelations.ownerId }).from(socialRelations).where(and(
    eq(socialRelations.ownerId, viewer), eq(socialRelations.targetId, id), eq(socialRelations.kind, 'favorite'),
  )).limit(1);
  const blocked = id !== viewer && await pairBlocked(viewer, id);
  const ownBlock = id !== viewer ? await db.select({ id: socialRelations.ownerId }).from(socialRelations).where(and(
    eq(socialRelations.ownerId, viewer), eq(socialRelations.targetId, id), eq(socialRelations.kind, 'block'),
  )).limit(1) : [];
  const photos = blocked ? { photoUrl: null, photoUrls: [], photoReviews: [] } : await visibleProfilePhotos(id, viewer, profile);
  const [counts, style] = await Promise.all([
    includeStats ? db.select({
      followerCount: sql<number>`count(*) filter (where ${socialRelations.targetId} = ${id})::int`,
      followingCount: sql<number>`count(*) filter (where ${socialRelations.ownerId} = ${id})::int`,
    }).from(socialRelations).where(and(eq(socialRelations.kind, 'favorite'), or(
      eq(socialRelations.ownerId, id), eq(socialRelations.targetId, id),
    ))) : Promise.resolve([]),
    getProfileCosmeticStyle(id),
  ]);
  return {
    username: profile.username,
    displayName: profile.displayName?.trim() || profile.username,
    ...photos,
    identity: publicProfile(profile).identity,
    race: prefs?.race ?? 'Human',
    job: prefs?.job ?? null,
    favorite: favoriteRows.length > 0,
    blocked: ownBlock.length > 0,
    frameId: style.frameId,
    displayNameColor: style.displayNameColor,
    displayNameTierIndex: style.displayNameTierIndex,
    hasNameShimmer: style.specialNameId === 'shimmer',
    ...(includeStats ? {
      followerCount: counts[0]?.followerCount ?? 0,
      followingCount: counts[0]?.followingCount ?? 0,
    } : {}),
  };
}
