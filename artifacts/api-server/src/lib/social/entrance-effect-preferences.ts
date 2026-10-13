import { eq } from "drizzle-orm";
import type { EntranceEffectSettingsInput } from "@workspace/api-zod";
import { db, socialSettings } from "@workspace/db";
import { RoomError } from "../room-store";
import { ensureSocial, lockAccounts, requireAccount } from "./core";
import { MONTHLY_CREDIT_BADGE_TIERS } from "./monthly-credit-badge-config";
import {
  chooseAccountEntranceEffect,
  hasOwnerTierTestAccess,
  isTierEntranceEffectEnabled,
} from "./owner-entrance-effects-policy";
import { accountBadgeState } from "./monthly-credit-badges";
import { ROOM_ENTRANCE_EFFECT_DURATION_MS } from "../room-entrance-effects";

const enabledTiersFrom = (value: Record<string, boolean> | null | undefined) =>
  MONTHLY_CREDIT_BADGE_TIERS.map(tier => ({
    badgeId: tier.id,
    name: tier.name,
    enabled: isTierEntranceEffectEnabled(value, tier.id),
  }));

export async function getMyEntranceEffectSettings(accountId: string) {
  const profile = await requireAccount(accountId);
  await ensureSocial(accountId);
  const [preferences] = await db.select({
    enabled: socialSettings.entranceEffectsEnabled,
    tierEffects: socialSettings.ownerTierEntranceEffects,
    lionEnabled: socialSettings.ownerLionEntranceEnabled,
  }).from(socialSettings).where(eq(socialSettings.accountId, accountId)).limit(1);
  const ownerTest = hasOwnerTierTestAccess(profile, process.env.NODE_ENV);
  const badgeState = await accountBadgeState(accountId);
  const displayedBadge = badgeState.equippedBadge;
  return {
    eligible: ownerTest || badgeState.badges.length > 0,
    enabled: preferences?.enabled ?? true,
    badgeId: displayedBadge?.tier.id ?? null,
    badgeName: displayedBadge?.tier.name ?? null,
    ownerTest: ownerTest ? {
      tiers: enabledTiersFrom(preferences?.tierEffects),
      lionEffectEnabled: preferences?.lionEnabled ?? true,
    } : null,
  };
}

export async function saveMyEntranceEffectSettings(accountId: string, input: EntranceEffectSettingsInput) {
  const profile = await requireAccount(accountId);
  await ensureSocial(accountId);
  const ownerTest = hasOwnerTierTestAccess(profile, process.env.NODE_ENV);
  const hasOwnerFields = input.tierEffectId !== undefined || input.tierEffectEnabled !== undefined
    || input.lionEffectEnabled !== undefined;
  const badgeState = await accountBadgeState(accountId);

  if (input.tierEffectId !== undefined && input.tierEffectEnabled === undefined
    || input.tierEffectId === undefined && input.tierEffectEnabled !== undefined) {
    throw new RoomError(400, "Choose a tier and its on/off setting together");
  }
  if (hasOwnerFields && !ownerTest) throw new RoomError(403, "Owner preview controls are not available for this account");
  if (!ownerTest && input.enabled !== undefined && badgeState.badges.length === 0)
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
  const badgeState = await accountBadgeState(accountId);
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
  if (settings.enabled === false) return null;
  const equipped = badgeState.equippedBadge;
  const effectId = chooseAccountEntranceEffect({
    ownerPreview,
    enabled: settings.enabled,
    equippedBadgeId: equipped?.tier.id ?? null,
    lionEnabled: settings.lionEnabled,
    enabledTierIds: MONTHLY_CREDIT_BADGE_TIERS
      .filter(tier => isTierEntranceEffectEnabled(settings.tierEffects, tier.id))
      .map(tier => tier.id),
  });
  if (!effectId) return null;
  if (effectId === "lion-entrance") return { effectId, durationMs: ROOM_ENTRANCE_EFFECT_DURATION_MS } as const;
  const tier = MONTHLY_CREDIT_BADGE_TIERS.find(candidate => candidate.entranceEffectId === effectId);
  return tier ? { effectId: tier.entranceEffectId, durationMs: tier.durationMs } : null;
}
