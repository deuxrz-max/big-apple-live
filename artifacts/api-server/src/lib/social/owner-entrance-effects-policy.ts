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

export function chooseAccountEntranceEffect(input: {
  ownerPreview: boolean;
  enabled: boolean;
  equippedBadgeId: string | null;
  lionEnabled: boolean;
  enabledTierIds: string[];
}): EntranceEffectChoice | null {
  if (!input.enabled) return null;
  if (!input.equippedBadgeId) return null;
  if (input.equippedBadgeId === "lion-entrance")
    return input.ownerPreview && input.lionEnabled ? "lion-entrance" : null;
  const equippedTier = MONTHLY_CREDIT_BADGE_TIERS.find(tier => tier.id === input.equippedBadgeId);
  if (!equippedTier) return null;
  if (input.ownerPreview && !input.enabledTierIds.includes(equippedTier.id)) return null;
  return equippedTier.entranceEffectId;
}
