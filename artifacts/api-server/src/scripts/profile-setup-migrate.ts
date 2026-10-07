import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

const counts = `SELECT
 (SELECT count(*)::int FROM account_profiles) profiles,
 (SELECT count(*)::int FROM room_messages) messages,
 (SELECT count(*)::int FROM social_ledger) ledger`;
try {
  const before = await pool.query(counts);
  await pool.query(await readFile("scripts/profile-setup-migration.sql", "utf8"));
  const after = await pool.query(counts);
  console.info("Additive profile migration counts", { before: before.rows[0], after: after.rows[0] });
} finally {
  await pool.end();
}
