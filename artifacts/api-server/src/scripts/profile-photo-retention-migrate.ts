import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

try {
  await pool.query(await readFile("scripts/profile-photo-retention-migration.sql", "utf8"));
  console.info("Additive photo retention migration applied; no files or user data deleted");
} finally {
  await pool.end();
}
