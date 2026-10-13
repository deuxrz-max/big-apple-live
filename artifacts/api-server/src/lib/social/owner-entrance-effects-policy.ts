import { MONTHLY_CREDIT_BADGE_TIERS } from "./monthly-credit-badge-config";

export const OWNER_BADGE_TEST_USERNAME = "vampsquad";
export type MonthlyTierEntranceEffectId = typeof MONTHLY_CREDIT_BADGE_TIERS[number]["entranceEffectId"];
export type EntranceEffectChoice = "lion-entrance" | MonthlyTierEntranceEffectId;

export function isOwnerAccount(profile: { username: string; isTestAccount: boolean }) {
  return !profile.isTestAccount && profile.username.trim().toLowerCase() === OWNER_BADGE_TEST_USERNAME;
}

export function hasOwnerTierTestAccess(
  profile: { username: string; isTestAccount: boolean },
  nodeEnv = process.env.NODE_ENV,
) {
  return nodeEnv === "development" && isOwnerAccount(profile);
}

export function chooseOwnerEntranceEffect(input: {
  lionEnabled: boolean;
  enabledTierIds: string[];
}): EntranceEffectChoice | null {
  if (input.lionEnabled) return "lion-entrance";
  return [...MONTHLY_CREDIT_BADGE_TIERS]
    .sort((a, b) => b.rank - a.rank)
    .find(tier => input.enabledTierIds.includes(tier.id))?.entranceEffectId ?? null;
}

export function chooseAccountEntranceEffect(input: {
  ownerPreview: boolean;
  enabled: boolean;
  lionEnabled: boolean;
  enabledTierIds: string[];
  ownedTierEffectId: MonthlyTierEntranceEffectId | null;
  ownerAccount: boolean;
}): EntranceEffectChoice | null {
  if (!input.enabled) return null;
  if (input.ownerPreview) return chooseOwnerEntranceEffect({
    lionEnabled: input.lionEnabled,
    enabledTierIds: input.enabledTierIds,
  });
  if (input.ownedTierEffectId) return input.ownedTierEffectId;
  return input.ownerAccount && input.lionEnabled ? "lion-entrance" : null;
}
