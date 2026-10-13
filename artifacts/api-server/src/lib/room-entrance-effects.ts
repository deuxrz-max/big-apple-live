import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, accountRoomEntranceEffects } from "@workspace/db";
import { MONTHLY_CREDIT_BADGE_TIERS } from "./social/monthly-credit-badge-config";

export const ROOM_ENTRANCE_EFFECT_DURATION_MS = 6_066;
export const ROOM_ENTRANCE_EFFECT_ID = "lion-entrance" as const;
export type RoomEntranceEffectId = typeof ROOM_ENTRANCE_EFFECT_ID | typeof MONTHLY_CREDIT_BADGE_TIERS[number]["entranceEffectId"];

const recentEntryClaims = new Map<string, number>();
const ENTRY_CLAIM_TTL_MS = 5 * 60_000;

/** Deduplicates retries of one room-entry request without suppressing later joins. */
export async function claimRoomEntranceEffect(
  accountId: string,
  effectId: RoomEntranceEffectId = ROOM_ENTRANCE_EFFECT_ID,
  entryId: string = randomUUID(),
  now = Date.now(),
): Promise<RoomEntranceEffectId | null> {
  for (const [key, at] of recentEntryClaims) {
    if (now - at > ENTRY_CLAIM_TTL_MS) recentEntryClaims.delete(key);
  }
  const claimKey = `${accountId}\u0000${effectId}\u0000${entryId}`;
  if (recentEntryClaims.has(claimKey)) return null;
  recentEntryClaims.set(claimKey, now);

  try {
    if (effectId !== ROOM_ENTRANCE_EFFECT_ID) {
      await db.insert(accountRoomEntranceEffects).values({ accountId, effectId }).onConflictDoNothing();
    }
    await db.update(accountRoomEntranceEffects)
      .set({ lastTriggeredAt: new Date(now) })
      .where(and(
        eq(accountRoomEntranceEffects.accountId, accountId),
        eq(accountRoomEntranceEffects.effectId, effectId),
      ));
  } catch (error) {
    recentEntryClaims.delete(claimKey);
    throw error;
  }
  return effectId;
}
