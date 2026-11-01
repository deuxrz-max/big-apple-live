import { db, accountProfiles, socialSettings, socialWallets, socialRelations, socialLoginStreaks, socialGiftBag, socialGiftBagLots } from "@workspace/db";
import { and, eq, ne, or, ilike, desc, isNotNull, isNull, lte, gt, sql } from "drizzle-orm";
import type { SocialProfileInput } from "@workspace/api-zod";
import { RoomError } from "../room-store";
import { assertContact, ensureSocial, lockAccounts, lockPair, pairBlocked, person, requireAccount, targetAccount, wallet } from "./core";
import { COUNTRIES, COUNTRY_CODES, PRODUCTS } from "./catalog";
import { roomStore } from "../room-store";
import { accountBadgeState, myBadgeViews, visibleMonthlyPurchaseBadgeSummaries } from "./monthly-credit-badges";
import { getMyEntranceEffectSettings } from "./entrance-effect-preferences";
import { giftCatalogWithActiveNames } from "../gift-studio-catalog";
import { nameColorProfileForAccount, nameColorPurchaseTotalOverride } from "./gift-name-color-data";
import { hasOwnerTierTestAccess } from "./owner-entrance-effects-policy";
import { getHangoutStreakSummary } from "../community-hangout-rewards";
import { realGiftingLevel } from "./gifting-access";
import { expirePurchasedGiftLots } from "./gift-bag-inventory";
import { testerState } from "./coin-testers";

export async function getMe(id: string) {
  const profile = await requireAccount(id);
  await ensureSocial(id);
  const now = new Date();
  const [expiredGiftLot] = await db.select({ id: socialGiftBagLots.id }).from(socialGiftBagLots)
    .where(and(eq(socialGiftBagLots.accountId, id), isNotNull(socialGiftBagLots.expiresAt), lte(socialGiftBagLots.expiresAt, now)))
    .limit(1);
  if (expiredGiftLot) await db.transaction(async tx => {
    await lockAccounts(tx, [id]);
    await expirePurchasedGiftLots(tx, id, now);
  });
  const giftBagLots = await db.select({
    giftId: socialGiftBagLots.giftId,
    quantity: socialGiftBagLots.quantity,
    expiresAt: socialGiftBagLots.expiresAt,
  }).from(socialGiftBagLots).where(and(eq(socialGiftBagLots.accountId, id),
    or(isNull(socialGiftBagLots.expiresAt), gt(socialGiftBagLots.expiresAt, now))))
    .orderBy(socialGiftBagLots.giftId, socialGiftBagLots.expiresAt);
  const tester = await testerState(id);
  const testLots = tester?.bag.filter(lot => new Date(lot.expiresAt) > now);
  const giftBag = testLots ?? giftBagLots.map(lot => ({ ...lot, expiresAt: lot.expiresAt?.toISOString() ?? null }));
  const [[streak], giftsOwned, badgeState, badges] = await Promise.all([
    db.select().from(socialLoginStreaks).where(eq(socialLoginStreaks.accountId, id)),
    db.select().from(socialGiftBag).where(eq(socialGiftBag.accountId, id)),
    accountBadgeState(id),
    myBadgeViews(id),
  ]);
  const [gifts, entranceEffects, hangoutStreak] = await Promise.all([
    giftCatalogWithActiveNames(),
    getMyEntranceEffectSettings(id),
    getHangoutStreakSummary(id),
  ]);
  const [nameColor, gifterAccessLevel] = await Promise.all([nameColorProfileForAccount(id), realGiftingLevel(id)]);
  const quantities = tester
    ? (testLots ?? []).reduce<Record<string, number>>((all, lot) => {
      all[lot.giftId] = (all[lot.giftId] ?? 0) + lot.quantity; return all;
    }, {})
    : Object.fromEntries(giftsOwned.map(g => [g.giftId, g.quantity]));
  return { profile: await person(id, profile, undefined, true, undefined, nameColor),
    gifterAccessLevel,
    nameColorProgress: {
      tierName: nameColor.tierName,
      tierIndex: nameColor.tierIndex,
      lifetimeCoinsPurchased: nameColor.lifetimeCoinsPurchased,
      nextTierName: nameColor.nextTierName,
      nextTierThreshold: nameColor.nextTierThreshold,
      coinsToNextTier: nameColor.coinsToNextTier,
    },
    nameColorTest: {
      enabled: hasOwnerTierTestAccess(profile),
      overrideCoins: hasOwnerTierTestAccess(profile) ? nameColorPurchaseTotalOverride(id) : null,
    },
    wallet: await wallet(id, db, profile.username), inventory: Object.keys(quantities),
    giftQuantities: quantities,
    giftBagLots: giftBag,
    badges,
    equippedBadgeId: badgeState.equippedBadgeId,
    badgeExpirations: Object.fromEntries(badges.filter(badge => badge.expiresAt)
      .map(badge => [badge.id, badge.expiresAt!])),
    loginStreak: streak?.consecutiveDays ?? 0, hangoutStreak, products: PRODUCTS, gifts, countries: COUNTRIES,
    entranceEffects };
}
export async function saveSocialProfile(id: string, input: SocialProfileInput) {
  const profile = await requireAccount(id);
  if (input.country && !COUNTRY_CODES.has(input.country)) throw new RoomError(400, "Choose a valid country");
  const interests = [...new Set(input.interests.map(x => x.trim()).filter(Boolean))];
  await db.transaction(async tx => {
    await lockAccounts(tx, [id]);
    if (input.badgeId) throw new RoomError(400, "Monthly purchase badges are automatic and cannot be selected manually");
    await tx.update(socialSettings).set({ bio: input.bio.trim(), country: input.country, interests,
      ...(input.externalPlatform !== undefined ? { externalPlatform: input.externalPlatform } : {}),
      ...(input.externalHandle !== undefined ? { externalHandle: input.externalHandle?.trim() || null } : {}),
      discoverable: input.discoverable, badgeId: null, updatedAt: new Date() }).where(eq(socialSettings.accountId, id));
  });
  return person(id, profile);
}
export async function getPerson(id: string, username: string) {
  const target = await targetAccount(username);
  if (target.accountId !== id) await assertContact(db, id, target.accountId);
  return person(id, target, undefined, true);
}
export type PeopleQuery = { search?: string; gender?: string; country?: string; favorites?: boolean; offset?: number };
export async function listPeople(id: string, input: PeopleQuery = {}, leaderboard = false) {
  const search = input.search?.trim().slice(0, 80).replace(/[\\%_]/g, "\\$&");
  const conditions = [
    leaderboard ? undefined : ne(accountProfiles.accountId, id),
    leaderboard || process.env.NODE_ENV === "production" ? eq(accountProfiles.isTestAccount, false) : undefined,
    input.favorites ? undefined : eq(socialSettings.discoverable, true),
    sql`NOT EXISTS (SELECT 1 FROM social_relations r WHERE r.kind = 'block' AND ((r.owner_id = ${id} AND r.target_id = ${accountProfiles.accountId}) OR (r.owner_id = ${accountProfiles.accountId} AND r.target_id = ${id})))`,
    search ? or(ilike(accountProfiles.username, `%${search}%`), ilike(socialSettings.bio, `%${search}%`)) : undefined,
    input.gender === "Male" || input.gender === "Female" ? eq(accountProfiles.gender, input.gender) : undefined,
    input.country ? eq(socialSettings.country, input.country) : undefined,
    input.favorites ? sql`EXISTS (SELECT 1 FROM social_relations f WHERE f.kind = 'favorite' AND f.owner_id = ${id} AND f.target_id = ${accountProfiles.accountId})` : undefined,
  ];
  const offset = Math.max(0, Math.min(100000, input.offset ?? 0));
  const rows = await db.select({ profile: accountProfiles, prefs: socialSettings })
    .from(accountProfiles).innerJoin(socialSettings, eq(accountProfiles.accountId, socialSettings.accountId))
    .leftJoin(socialWallets, eq(accountProfiles.accountId, socialWallets.accountId))
    .where(and(...conditions))
    .orderBy(...(leaderboard ? [desc(socialWallets.received), accountProfiles.nameKey] : [desc(socialSettings.updatedAt), accountProfiles.nameKey]))
    .limit(leaderboard ? 10 : 24).offset(offset);
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(accountProfiles)
    .innerJoin(socialSettings, eq(accountProfiles.accountId, socialSettings.accountId)).where(and(...conditions));
  const badges = await visibleMonthlyPurchaseBadgeSummaries(rows.map(row => row.profile.accountId));
  return { people: await Promise.all(rows.map(row => person(id, row.profile, row.prefs, false,
    badges.get(row.profile.accountId) ?? null))), total: count?.total ?? 0 };
}
export async function relationship(id: string, username: string, kind: "favorite" | "block", active: boolean) {
  const target = await targetAccount(username);
  if (id === target.accountId) throw new RoomError(400, "Choose another person");
  await db.transaction(async tx => {
    await lockPair(tx, id, target.accountId);
    if (kind === "favorite" && active) await assertContact(tx, id, target.accountId);
    if (active) await tx.insert(socialRelations).values({ ownerId: id, targetId: target.accountId, kind }).onConflictDoNothing();
    else await tx.delete(socialRelations).where(and(eq(socialRelations.ownerId, id), eq(socialRelations.targetId, target.accountId), eq(socialRelations.kind, kind)));
    if (kind === "block" && active) await tx.delete(socialRelations).where(and(eq(socialRelations.kind, "favorite"), or(
      and(eq(socialRelations.ownerId, id), eq(socialRelations.targetId, target.accountId)),
      and(eq(socialRelations.ownerId, target.accountId), eq(socialRelations.targetId, id)),
    )));
  });
  if (kind === "block") roomStore.refreshChatVisibility();
  return { ok: true };
}
export async function blocks(id: string) {
  const rows = await db.select({ profile: accountProfiles }).from(socialRelations)
    .innerJoin(accountProfiles, eq(accountProfiles.accountId, socialRelations.targetId))
    .where(and(eq(socialRelations.ownerId, id), eq(socialRelations.kind, "block"),
      process.env.NODE_ENV === "production" ? eq(accountProfiles.isTestAccount, false) : undefined))
    .orderBy(accountProfiles.nameKey);
  const badges = await visibleMonthlyPurchaseBadgeSummaries(rows.map(row => row.profile.accountId));
  return { people: await Promise.all(rows.map(r => person(id, r.profile, undefined, false,
    badges.get(r.profile.accountId) ?? null))), total: rows.length };
}
