import { eq } from "drizzle-orm";
import type { EntranceEffectSettingsInput } from "@workspace/api-zod";
import { db, socialSettings } from "@workspace/db";
import { RoomError } from "../room-store";
import { ensureSocial, lockAccounts, requireAccount } from "./core";
import { MONTHLY_CREDIT_BADGE_TIERS } from "./monthly-credit-badge-config";
import { chooseAccountEntranceEffect, hasOwnerTierTestAccess } from "./owner-entrance-effects-policy";
import { monthlyPurchaseBadgeSummary } from "./monthly-credit-badges";
import { ROOM_ENTRANCE_EFFECT_DURATION_MS } from "../room-entrance-effects";

const enabledTiersFrom = (value: Record<string, boolean> | null | undefined) =>
  MONTHLY_CREDIT_BADGE_TIERS.map(tier => ({
    badgeId: tier.id,
    name: tier.name,
    enabled: value?.[tier.id] === true,
  }));

export async function getMyEntranceEffectSettings(accountId: string) {
  const profile = await requireAccount(accountId);
  await ensureSocial(accountId);
  const [preferences] = await db.select({
    enabled: socialSettings.entranceEffectsEnabled,
    selectedTier: socialSettings.ownerTestBadgeTier,
    tierEffects: socialSettings.ownerTierEntranceEffects,
    lionEnabled: socialSettings.ownerLionEntranceEnabled,
  }).from(socialSettings).where(eq(socialSettings.accountId, accountId)).limit(1);
  const ownerTest = hasOwnerTierTestAccess(profile, process.env.NODE_ENV);
  const actualBadge = ownerTest ? null : await monthlyPurchaseBadgeSummary(accountId);
  const selectedTier = MONTHLY_CREDIT_BADGE_TIERS.find(tier => tier.rank === (preferences?.selectedTier ?? 5))
    ?? MONTHLY_CREDIT_BADGE_TIERS[4];
  const displayedTier = ownerTest ? selectedTier : actualBadge?.tier ?? null;
  return {
    eligible: ownerTest || !!actualBadge,
    enabled: preferences?.enabled ?? true,
    badgeId: displayedTier?.id ?? null,
    badgeName: displayedTier?.name ?? null,
    ownerTest: ownerTest ? {
      selectedBadgeId: selectedTier.id,
      tiers: enabledTiersFrom(preferences?.tierEffects),
      lionEffectEnabled: preferences?.lionEnabled ?? true,
    } : null,
  };
}

export async function saveMyEntranceEffectSettings(accountId: string, input: EntranceEffectSettingsInput) {
  const profile = await requireAccount(accountId);
  await ensureSocial(accountId);
  const ownerTest = hasOwnerTierTestAccess(profile, process.env.NODE_ENV);
  const hasOwnerFields = input.selectedBadgeId !== undefined
    || input.tierEffectId !== undefined || input.tierEffectEnabled !== undefined
    || input.lionEffectEnabled !== undefined;

  if (input.tierEffectId !== undefined && input.tierEffectEnabled === undefined
    || input.tierEffectId === undefined && input.tierEffectEnabled !== undefined) {
    throw new RoomError(400, "Choose a tier and its on/off setting together");
  }
  if (hasOwnerFields && !ownerTest) throw new RoomError(403, "Owner preview controls are not available for this account");
  if (!ownerTest && input.enabled !== undefined && !(await monthlyPurchaseBadgeSummary(accountId)))
    throw new RoomError(403, "An active monthly purchase badge is required");
  if (input.enabled === undefined && !hasOwnerFields)
    throw new RoomError(400, "Choose an entrance-effect setting to update");

  await db.transaction(async tx => {
    await lockAccounts(tx, [accountId]);
    const [current] = await tx.select({
      tierEffects: socialSettings.ownerTierEntranceEffects,
    }).from(socialSettings).where(eq(socialSettings.accountId, accountId)).limit(1);
    const patch: Partial<typeof socialSettings.$inferInsert> = { updatedAt: new Date() };
    if (input.enabled !== undefined) patch.entranceEffectsEnabled = input.enabled;
    if (input.selectedBadgeId !== undefined) {
      const tier = MONTHLY_CREDIT_BADGE_TIERS.find(candidate => candidate.id === input.selectedBadgeId);
      if (!tier) throw new RoomError(400, "Choose a valid tier badge");
      patch.ownerTestBadgeTier = tier.rank;
    }
    if (input.tierEffectId !== undefined && input.tierEffectEnabled !== undefined) {
      patch.ownerTierEntranceEffects = {
        ...(current?.tierEffects ?? {}),
        [input.tierEffectId]: input.tierEffectEnabled,
      };
    }
    if (input.lionEffectEnabled !== undefined) patch.ownerLionEntranceEnabled = input.lionEffectEnabled;
    await tx.update(socialSettings).set(patch).where(eq(socialSettings.accountId, accountId));
  });

  return getMyEntranceEffectSettings(accountId);
}

export async function accountEntranceEffectSelection(accountId: string) {
  const profile = await requireAccount(accountId);
  const ownerPreview = hasOwnerTierTestAccess(profile, process.env.NODE_ENV);
  const actualBadge = ownerPreview ? null : await monthlyPurchaseBadgeSummary(accountId);
  const [preferences] = await db.select({
    enabled: socialSettings.entranceEffectsEnabled,
    tierEffects: socialSettings.ownerTierEntranceEffects,
    lionEnabled: socialSettings.ownerLionEntranceEnabled,
  }).from(socialSettings).where(eq(socialSettings.accountId, accountId)).limit(1);
  const settings = preferences ?? {
    enabled: true,
    tierEffects: {} as Record<string, boolean>,
    lionEnabled: true,
  };
  const effectId = chooseAccountEntranceEffect({
    ownerPreview,
    enabled: settings.enabled,
    lionEnabled: settings.lionEnabled,
    enabledTierIds: MONTHLY_CREDIT_BADGE_TIERS
      .filter(tier => settings.tierEffects?.[tier.id] === true)
      .map(tier => tier.id),
    ownedTierEffectId: actualBadge?.tier.entranceEffectId ?? null,
    ownerAccount: profile.username.toLowerCase() === "vampsquad" && !profile.isTestAccount,
  });
  if (!effectId) return null;
  if (effectId === "lion-entrance") return { effectId, durationMs: ROOM_ENTRANCE_EFFECT_DURATION_MS } as const;
  const tier = MONTHLY_CREDIT_BADGE_TIERS.find(candidate => candidate.entranceEffectId === effectId);
  return tier ? { effectId: tier.entranceEffectId, durationMs: tier.durationMs } : null;
}
