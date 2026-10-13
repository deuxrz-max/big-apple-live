import { and, eq, isNull, lte, or } from "drizzle-orm";
import { db, accountRoomEntranceEffects } from "@workspace/db";

export const ROOM_ENTRANCE_EFFECT_COOLDOWN_MS = 60_000;
export const ROOM_ENTRANCE_EFFECT_DURATION_MS = 6_066;
export const ROOM_ENTRANCE_EFFECT_ID = "lion-entrance" as const;

/** Atomically claims an assigned effect, globally limiting its replay per account to once a minute. */
export async function claimRoomEntranceEffect(accountId: string, now = Date.now()): Promise<typeof ROOM_ENTRANCE_EFFECT_ID | null> {
  const eligibleBefore = new Date(now - ROOM_ENTRANCE_EFFECT_COOLDOWN_MS);
  const [claimed] = await db.update(accountRoomEntranceEffects)
    .set({ lastTriggeredAt: new Date(now) })
    .where(and(
      eq(accountRoomEntranceEffects.accountId, accountId),
      eq(accountRoomEntranceEffects.effectId, ROOM_ENTRANCE_EFFECT_ID),
      or(isNull(accountRoomEntranceEffects.lastTriggeredAt), lte(accountRoomEntranceEffects.lastTriggeredAt, eligibleBefore)),
    ))
    .returning({ effectId: accountRoomEntranceEffects.effectId });
  return claimed ? ROOM_ENTRANCE_EFFECT_ID : null;
}
