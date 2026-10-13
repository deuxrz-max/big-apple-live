import { and, eq, isNull, lte, or } from "drizzle-orm";
import { db, accountRoomEntranceEffects } from "@workspace/db";
import { MONTHLY_CREDIT_BADGE_TIERS } from "./social/monthly-credit-badge-config";

export const ROOM_ENTRANCE_EFFECT_COOLDOWN_MS = 60_000;
export const ROOM_ENTRANCE_EFFECT_DURATION_MS = 6_066;
export const ROOM_ENTRANCE_EFFECT_ID = "lion-entrance" as const;
export type RoomEntranceEffectId = typeof ROOM_ENTRANCE_EFFECT_ID | typeof MONTHLY_CREDIT_BADGE_TIERS[number]["entranceEffectId"];

/** Atomically claims an assigned effect, globally limiting its replay per account to once a minute. */
export async function claimRoomEntranceEffect(accountId: string, effectId: RoomEntranceEffectId = ROOM_ENTRANCE_EFFECT_ID, now = Date.now()): Promise<RoomEntranceEffectId | null> {
  if (effectId !== ROOM_ENTRANCE_EFFECT_ID) {
    await db.insert(accountRoomEntranceEffects).values({ accountId, effectId }).onConflictDoNothing();
  }
  const eligibleBefore = new Date(now - ROOM_ENTRANCE_EFFECT_COOLDOWN_MS);
  const [claimed] = await db.update(accountRoomEntranceEffects)
    .set({ lastTriggeredAt: new Date(now) })
    .where(and(
      eq(accountRoomEntranceEffects.accountId, accountId),
      eq(accountRoomEntranceEffects.effectId, effectId),
      or(isNull(accountRoomEntranceEffects.lastTriggeredAt), lte(accountRoomEntranceEffects.lastTriggeredAt, eligibleBefore)),
    ))
    .returning({ effectId: accountRoomEntranceEffects.effectId });
  return claimed ? effectId : null;
}
