import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

// Execute from workspace root after bundling. Never print credentials or rows.
const counts = `SELECT
 (SELECT count(*)::int FROM account_profiles) accounts,
 (SELECT count(*)::int FROM room_messages) messages,
 (SELECT count(*)::int FROM social_ledger) ledger`;
const before = await pool.query(counts);
await pool.query(await readFile("scripts/chat-pivot-migration.sql", "utf8"));
const after = await pool.query(counts);
console.info("Additive migration counts", { before: before.rows[0], after: after.rows[0] });
await pool.end();
