import { db, accountProfiles, socialSettings, socialRelations } from '@workspace/db';
import { and, eq, ne, or, ilike, desc, sql } from 'drizzle-orm';
import type { SocialProfileInput } from '@workspace/api-zod';
import { RoomError } from '../room-store';
import { assertContact, ensureSocial, lockPair, pairBlocked, person, requireAccount, targetAccount } from './core';
import { COUNTRIES } from './catalog';
import { roomStore } from '../room-store';

const STARTER_JOBS = new Set(['Apprentice', 'Squire', 'Initiate', 'Trapper', 'Novice', 'Acolyte', 'Scoundrel', 'Tinker']);

export async function getMe(id: string) {
  const profile = await requireAccount(id);
  await ensureSocial(id);
  return {
    profile: await person(id, profile, undefined, true),
    countries: COUNTRIES,
  };
}

export async function saveSocialProfile(id: string, input: SocialProfileInput) {
  const profile = await requireAccount(id);
  if (input.race !== undefined && input.race !== 'Human') throw new RoomError(400, 'Choose Human.');
  if (input.job !== undefined && input.job !== null && !STARTER_JOBS.has(input.job))
    throw new RoomError(400, 'Choose one of the available starter jobs.');
  await db.transaction(async tx => {
    await ensureSocial(id, tx);
    await tx.update(socialSettings).set({
      ...(input.race !== undefined ? { race: input.race } : {}),
      ...(input.job !== undefined ? { job: input.job } : {}),
      updatedAt: new Date(),
    }).where(eq(socialSettings.accountId, id));
  });
  return person(id, profile);
}

export async function getPerson(id: string, username: string) {
  const target = await targetAccount(username);
  if (target.accountId !== id && await pairBlocked(id, target.accountId))
    throw new RoomError(403, 'This interaction is not available while either person has blocked the other');
  return person(id, target, undefined, true);
}

export type PeopleQuery = { search?: string; gender?: string; country?: string; favorites?: boolean; offset?: number };

export async function listPeople(id: string, input: PeopleQuery = {}, leaderboard = false) {
  const search = input.search?.trim().replace(/^@/, '').slice(0, 80).replace(/[\\%_]/g, '\\$&');
  const conditions = [
    ne(accountProfiles.accountId, id),
    process.env.NODE_ENV === 'production' ? eq(accountProfiles.isTestAccount, false) : undefined,
    sql`NOT EXISTS (
      SELECT 1 FROM social_relations r
      WHERE r.kind = 'block'
        AND ((r.owner_id = ${id} AND r.target_id = ${accountProfiles.accountId})
          OR (r.owner_id = ${accountProfiles.accountId} AND r.target_id = ${id}))
    )`,
    search ? or(ilike(accountProfiles.username, `%${search}%`), ilike(accountProfiles.displayName, `%${search}%`)) : undefined,
    input.gender === 'Male' || input.gender === 'Female' ? eq(accountProfiles.gender, input.gender) : undefined,
    input.country ? eq(socialSettings.country, input.country) : undefined,
    input.favorites ? sql`EXISTS (
      SELECT 1 FROM social_relations f
      WHERE f.kind = 'favorite' AND f.owner_id = ${id} AND f.target_id = ${accountProfiles.accountId}
    )` : undefined,
  ];
  const offset = Math.max(0, Math.min(100000, input.offset ?? 0));
  const rows = await db.select({ profile: accountProfiles, prefs: socialSettings })
    .from(accountProfiles).leftJoin(socialSettings, eq(accountProfiles.accountId, socialSettings.accountId))
    .where(and(...conditions))
    .orderBy(...(leaderboard ? [desc(accountProfiles.updatedAt), accountProfiles.nameKey] : [desc(socialSettings.updatedAt), accountProfiles.nameKey]))
    .limit(leaderboard ? 10 : 24).offset(offset);
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(accountProfiles)
    .leftJoin(socialSettings, eq(accountProfiles.accountId, socialSettings.accountId)).where(and(...conditions));
  return { people: await Promise.all(rows.map(row => person(id, row.profile, row.prefs, false))), total: count?.total ?? 0 };
}

export async function relationship(id: string, username: string, kind: 'favorite' | 'block', active: boolean) {
  const target = await targetAccount(username);
  if (id === target.accountId) throw new RoomError(400, 'Choose another person');
  await db.transaction(async tx => {
    await lockPair(tx, id, target.accountId);
    if (kind === 'favorite' && active) await assertContact(tx, id, target.accountId);
    if (active) await tx.insert(socialRelations).values({ ownerId: id, targetId: target.accountId, kind }).onConflictDoNothing();
    else await tx.delete(socialRelations).where(and(
      eq(socialRelations.ownerId, id), eq(socialRelations.targetId, target.accountId), eq(socialRelations.kind, kind),
    ));
    if (kind === 'block' && active) await tx.delete(socialRelations).where(and(eq(socialRelations.kind, 'favorite'), or(
      and(eq(socialRelations.ownerId, id), eq(socialRelations.targetId, target.accountId)),
      and(eq(socialRelations.ownerId, target.accountId), eq(socialRelations.targetId, id)),
    )));
  });
  if (kind === 'block') roomStore.refreshChatVisibility();
  return { ok: true };
}

export async function blocks(id: string) {
  const rows = await db.select({ profile: accountProfiles }).from(socialRelations)
    .innerJoin(accountProfiles, eq(accountProfiles.accountId, socialRelations.targetId))
    .where(and(eq(socialRelations.ownerId, id), eq(socialRelations.kind, 'block'),
      process.env.NODE_ENV === 'production' ? eq(accountProfiles.isTestAccount, false) : undefined))
    .orderBy(accountProfiles.nameKey);
  return { people: await Promise.all(rows.map(row => person(id, row.profile))), total: rows.length };
}
