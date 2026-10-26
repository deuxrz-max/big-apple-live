import { pool } from "@workspace/db";
// Explicit additive development migration. Never use schema push/truncation here.
if (process.env.NODE_ENV !== "development") throw new Error("Development migration only");
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(`
    CREATE TABLE IF NOT EXISTS pink_reward_preferences (
      account_id text PRIMARY KEY REFERENCES account_profiles(account_id) ON DELETE CASCADE,
      opted_out boolean NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS pink_reward_entries (
      cycle text NOT NULL,
      account_id text NOT NULL REFERENCES account_profiles(account_id) ON DELETE CASCADE,
      claimed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(cycle, account_id)
    );
    CREATE TABLE IF NOT EXISTS pink_reward_draws (
      id text PRIMARY KEY, cycle text NOT NULL,
      slot integer NOT NULL CHECK(slot BETWEEN 0 AND 5),
      scheduled_at timestamptz NOT NULL, settled_at timestamptz,
      outcome text, winner_id text REFERENCES account_profiles(account_id) ON DELETE SET NULL,
      winner_name text, prize_id text, prize_name text
    );
    CREATE INDEX IF NOT EXISTS pink_reward_winner_cooldown ON pink_reward_draws(winner_id, settled_at);
  `);
  await client.query("COMMIT");
  process.stdout.write("Added only the three pink reward tables and cooldown index.\n");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
