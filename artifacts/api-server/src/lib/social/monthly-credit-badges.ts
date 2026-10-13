import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, accountProfiles, socialCreditPurchases, socialSettings } from "@workspace/db";
import { evaluateMonthlyPurchaseBadges, type MonthlyCreditBadgeSummary } from "./monthly-credit-badge-policy";
import { MONTHLY_CREDIT_BADGE_TIERS } from "./monthly-credit-badge-config";
import { hasOwnerTierTestAccess } from "./owner-entrance-effects-policy";
import { RoomError } from "../room-store";

export { evaluateMonthlyPurchaseBadges } from "./monthly-credit-badge-policy";
export type { MonthlyCreditBadgeSummary } from "./monthly-credit-badge-policy";

type BadgeDefinition = {
  id: string;
  rank: number;
  name: string;
  monthlyCredits: number;
  badgeImage: string;
  entranceEffectId: string;
  entranceEffectFolder: string;
  durationMs: number;
};

export type VisibleMonthlyBadgeSummary = {
  tier: BadgeDefinition;
  earnedAt: Date;
  expiresAt: Date;
  monthKey: string;
  monthlyCredits: number;
};

export type OwnedBadgeSummary = {
  tier: BadgeDefinition;
  earnedAt: Date;
  expiresAt: Date | null;
  monthKey: string;
  monthlyCredits: number;
  permanent: boolean;
};

export type MyBadgeView = {
  id: string;
  name: string;
  badgeImage: string;
  rank: number;
  earnedAt: string;
  expiresAt: string | null;
  daysLeft: number | null;
  permanent: boolean;
  equipped: boolean;
};

export type AccountBadgeState = {
  badges: OwnedBadgeSummary[];
  equippedBadgeId: string | null;
  equippedBadge: OwnedBadgeSummary | null;
  ownerPreview: boolean;
};

export const OWNER_LION_BADGE_ID = "lion-entrance";
const OWNER_LION_BADGE: BadgeDefinition = {
  id: OWNER_LION_BADGE_ID,
  rank: 0,
  name: "Lion Entrance",
  monthlyCredits: 0,
  // Reuse the owner's existing lion-themed coin art as the compact test marker.
  badgeImage: "/badges/monthly-credit-tiers/tier4.png",
  entranceEffectId: "lion-entrance",
  entranceEffectFolder: "/room-entry-effects/lion",
  durationMs: 6_500,
};
const PERMANENT_DISPLAY_EXPIRY = new Date("9999-12-31T23:59:59.999Z");
const OWNER_BADGE_MONTH = "owner-test";

const startOfUtcMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
const activePurchaseWindowStart = (now: Date) =>
  startOfUtcMonth(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));

export async function monthlyPurchaseBadgeAwards(accountIds: string[], now = new Date()) {
  const ids = [...new Set(accountIds.filter(Boolean))];
  const result = new Map<string, MonthlyCreditBadgeSummary[]>();
  if (!ids.length) return result;
  const rows = await db.select({
    accountId: socialCreditPurchases.accountId,
    credits: socialCreditPurchases.credits,
    confirmedAt: socialCreditPurchases.confirmedAt,
  }).from(socialCreditPurchases).where(and(
    inArray(socialCreditPurchases.accountId, ids),
    gte(socialCreditPurchases.confirmedAt, activePurchaseWindowStart(now)),
    lte(socialCreditPurchases.confirmedAt, now),
  )).orderBy(asc(socialCreditPurchases.confirmedAt));
  const evaluated = evaluateMonthlyPurchaseBadges(rows, now).result;
  for (const id of ids) result.set(id, evaluated.get(id) ?? []);
  return result;
}

/** The highest currently active purchase badge. This reads confirmed purchase receipts only. */
export async function monthlyPurchaseBadgeSummaries(accountIds: string[], now = new Date()) {
  const awards = await monthlyPurchaseBadgeAwards(accountIds, now);
  return new Map([...awards].map(([id, badges]) => [id, badges[0] ?? null]));
}

export async function monthlyPurchaseBadgeSummary(accountId: string, now = new Date()) {
  return (await monthlyPurchaseBadgeSummaries([accountId], now)).get(accountId) ?? null;
}

function ownerTestBadges(earnedAt: Date): OwnedBadgeSummary[] {
  return [
    ...MONTHLY_CREDIT_BADGE_TIERS.map(tier => ({
      tier,
      earnedAt,
      expiresAt: null,
      monthKey: OWNER_BADGE_MONTH,
      monthlyCredits: 0,
      permanent: true,
    })),
    {
      tier: OWNER_LION_BADGE,
      earnedAt,
      expiresAt: null,
      monthKey: OWNER_BADGE_MONTH,
      monthlyCredits: 0,
      permanent: true,
    },
  ].sort((a, b) => b.tier.rank - a.tier.rank);
}

function highestRankBadge(badges: OwnedBadgeSummary[]) {
  return [...badges].sort((a, b) => b.tier.rank - a.tier.rank)[0] ?? null;
}

async function badgeStatesForAccounts(accountIds: string[], now: Date) {
  const ids = [...new Set(accountIds.filter(Boolean))];
  const states = new Map<string, AccountBadgeState>();
  if (!ids.length) return states;

  const [purchaseAwards, profiles, preferences] = await Promise.all([
    monthlyPurchaseBadgeAwards(ids, now),
    db.select({
      accountId: accountProfiles.accountId,
      username: accountProfiles.username,
      isTestAccount: accountProfiles.isTestAccount,
      updatedAt: accountProfiles.updatedAt,
    }).from(accountProfiles).where(inArray(accountProfiles.accountId, ids)),
    db.select({
      accountId: socialSettings.accountId,
      equippedBadgeId: socialSettings.equippedBadgeId,
      badgeEquipPreferenceSet: socialSettings.badgeEquipPreferenceSet,
      legacyOwnerTier: socialSettings.ownerTestBadgeTier,
    }).from(socialSettings).where(inArray(socialSettings.accountId, ids)),
  ]);
  const profileById = new Map(profiles.map(profile => [profile.accountId, profile]));
  const preferencesById = new Map(preferences.map(row => [row.accountId, row]));

  for (const id of ids) {
    const profile = profileById.get(id);
    const settings = preferencesById.get(id);
    const ownerPreview = profile ? hasOwnerTierTestAccess(profile, process.env.NODE_ENV) : false;
    const badges: OwnedBadgeSummary[] = ownerPreview && profile
      ? ownerTestBadges(profile.updatedAt)
      : (purchaseAwards.get(id) ?? []).map(badge => ({
        ...badge,
        permanent: false,
      }));

    const hasExplicitChoice = settings?.badgeEquipPreferenceSet === true;
    const savedBadgeId = settings?.equippedBadgeId ?? null;
    const legacyOwnerTier = settings?.legacyOwnerTier ?? 5;
    const defaultBadgeId = ownerPreview && !hasExplicitChoice
      ? MONTHLY_CREDIT_BADGE_TIERS.find(tier => tier.rank === legacyOwnerTier)?.id ?? "monthly-tier-5"
      : highestRankBadge(badges)?.tier.id ?? null;

    let selected = hasExplicitChoice
      ? (savedBadgeId ? badges.find(badge => badge.tier.id === savedBadgeId) ?? null : null)
      : savedBadgeId
        ? badges.find(badge => badge.tier.id === savedBadgeId) ?? null
        : badges.find(badge => badge.tier.id === defaultBadgeId) ?? null;

    // A saved badge that has expired falls back to the highest remaining one.
    if (!selected && (savedBadgeId !== null || !hasExplicitChoice))
      selected = highestRankBadge(badges);

    states.set(id, {
      badges,
      equippedBadgeId: selected?.tier.id ?? null,
      equippedBadge: selected,
      ownerPreview,
    });
  }
  return states;
}

export async function accountBadgeState(accountId: string, now = new Date()) {
  return (await badgeStatesForAccounts([accountId], now)).get(accountId) ?? {
    badges: [], equippedBadgeId: null, equippedBadge: null, ownerPreview: false,
  };
}

export async function myBadgeViews(accountId: string, now = new Date()): Promise<MyBadgeView[]> {
  const state = await accountBadgeState(accountId, now);
  return state.badges.map(badge => ({
    id: badge.tier.id,
    name: badge.tier.name,
    badgeImage: badge.tier.badgeImage,
    rank: badge.tier.rank,
    earnedAt: badge.earnedAt.toISOString(),
    expiresAt: badge.expiresAt?.toISOString() ?? null,
    daysLeft: badge.expiresAt
      ? Math.max(1, Math.ceil((badge.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
      : null,
    permanent: badge.permanent,
    equipped: badge.tier.id === state.equippedBadgeId,
  }));
}

export async function saveEquippedBadge(accountId: string, badgeId: string | null) {
  const now = new Date();
  const state = await accountBadgeState(accountId, now);
  if (badgeId !== null && !state.badges.some(badge => badge.tier.id === badgeId))
    throw new RoomError(403, "You do not have that active badge");

  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"social-wallet:" + accountId}, 0))`);
    await tx.insert(socialSettings).values({ accountId }).onConflictDoNothing();
    await tx.update(socialSettings).set({
      equippedBadgeId: badgeId,
      badgeEquipPreferenceSet: true,
      updatedAt: now,
    }).where(eq(socialSettings.accountId, accountId));
  });
  return { equippedBadgeId: badgeId };
}

function toVisibleSummary(badge: OwnedBadgeSummary): VisibleMonthlyBadgeSummary {
  return {
    tier: badge.tier,
    earnedAt: badge.earnedAt,
    expiresAt: badge.expiresAt ?? PERMANENT_DISPLAY_EXPIRY,
    monthKey: badge.monthKey,
    monthlyCredits: badge.monthlyCredits,
  };
}

/**
 * Rendering uses the equipped active badge; purchase calculations continue to use
 * monthlyPurchaseBadgeAwards(), which reads only confirmed receipts.
 */
export async function visibleMonthlyPurchaseBadgeSummaries(accountIds: string[], now = new Date()) {
  const states = await badgeStatesForAccounts(accountIds, now);
  return new Map([...states].map(([id, state]) => [
    id,
    state.equippedBadge ? toVisibleSummary(state.equippedBadge) : null,
  ]));
}

export async function visibleMonthlyPurchaseBadgeSummary(accountId: string, now = new Date()) {
  return (await visibleMonthlyPurchaseBadgeSummaries([accountId], now)).get(accountId) ?? null;
}
