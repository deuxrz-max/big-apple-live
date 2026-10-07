import { and, eq, inArray, sql } from "drizzle-orm";
import { db, profilePhotos } from "@workspace/db";
import { removeRetiredPhotoObject } from "./profile-photo-storage";
import { logger } from "./logger";

// Approved by the user: 30 days unused, not 30 days since original upload.
export const PHOTO_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 25;
const INTERVAL_MS = 60 * 60 * 1000;
const unreferenced = sql`NOT EXISTS (
  SELECT 1 FROM account_profiles p
  WHERE p.photo_url = '/api/photos/' || ${profilePhotos.id}::text
)`;
const eligible = (now: Date) => and(unreferenced, sql`
  (${profilePhotos.deletionStartedAt} IS NOT NULL OR
   ${profilePhotos.unusedSince} <= ${new Date(now.getTime() - PHOTO_GRACE_MS)})
`);

/** Read-only report. Bounded sample; counts cover all tracked objects. */
export async function reportPhotoRetention(now = new Date()) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
    const [totals] = await tx.select({
      tracked: sql<number>`count(*)::int`,
      eligible: sql<number>`count(*) FILTER (WHERE ${eligible(now)})::int`,
      eligibleBytes: sql<number>`coalesce(sum(${profilePhotos.size}) FILTER (WHERE ${eligible(now)}), 0)::float8`,
      current: sql<number>`count(*) FILTER (WHERE NOT (${unreferenced}))::int`,
    }).from(profilePhotos);
    const candidates = await tx.select({ id: profilePhotos.id, size: profilePhotos.size })
      .from(profilePhotos).where(eligible(now))
      .orderBy(profilePhotos.unusedSince, profilePhotos.id).limit(BATCH_SIZE);
    return { graceDays: 30, batchLimit: BATCH_SIZE, ...totals, candidates };
  });
}

/** The exact same lock used by saveProfile. Busy accounts are skipped, not queued. */
async function lockedPhoto<T>(accountId: string, action: (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
    const result = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${accountId})) AS locked`);
    if (!result.rows[0]?.locked) return undefined;
    return action(tx);
  });
}

/** Tombstone commits BEFORE object deletion; a crash cannot permit a broken save. */
export async function cleanupProfilePhotos(options: {
  dryRun?: boolean;
  // Tests can scope destructive work to freshly generated fixtures only.
  onlyIds?: string[];
  now?: Date;
} = {}) {
  const now = options.now ?? new Date();
  const report = await reportPhotoRetention(now);
  if (options.dryRun !== false) return { ...report, deleted: 0, failed: 0, skipped: 0 };
  const scope = options.onlyIds
    ? inArray(profilePhotos.id, options.onlyIds)
    : sql`true`;
  const candidates = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
    return tx.select().from(profilePhotos)
      .where(and(eligible(now), scope))
      .orderBy(profilePhotos.unusedSince, profilePhotos.id).limit(BATCH_SIZE);
  });
  let deleted = 0, failed = 0, skipped = 0;
  const deadline = Date.now() + 60_000;
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    try {
      const claimed = await lockedPhoto(candidate.accountId, async (tx) => {
        const [photo] = await tx.select().from(profilePhotos).where(and(
          eq(profilePhotos.id, candidate.id), eligible(now),
        ));
        if (!photo) return false;
        await tx.update(profilePhotos).set({ deletionStartedAt: photo.deletionStartedAt ?? now })
          .where(eq(profilePhotos.id, photo.id));
        return true;
      });
      if (!claimed) { skipped++; continue; }
      const removed = await lockedPhoto(candidate.accountId, async (tx) => {
        const [photo] = await tx.select().from(profilePhotos).where(and(
          eq(profilePhotos.id, candidate.id), eligible(now),
        ));
        if (!photo || !photo.deletionStartedAt) return false;
        await removeRetiredPhotoObject(photo.id, photo.objectKey);
        await tx.delete(profilePhotos).where(eq(profilePhotos.id, photo.id));
        return true;
      });
      if (removed) deleted++; else skipped++;
    } catch (err) {
      failed++;
      logger.error({ err, photoId: candidate.id }, "Photo cleanup failed; tombstone retained for safe retry");
    }
  }
  return { ...report, deleted, failed, skipped };
}

/** One bounded pass per hour in the existing service; never overlaps itself. */
export function startPhotoRetentionScheduler() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      logger.info({ report: await reportPhotoRetention() }, "Photo retention dry-run report");
      if (process.env.PROFILE_PHOTO_CLEANUP_MODE !== "dry-run")
        logger.info({ report: await cleanupProfilePhotos({ dryRun: false }) }, "Photo retention cleanup");
    } catch (err) {
      logger.error({ err }, "Photo retention unavailable; no broad storage sweep attempted");
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
