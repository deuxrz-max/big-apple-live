import { pool } from "@workspace/db";

// Additive migration only. Existing mixed-provenance inventory stays available indefinitely.
if (process.env.NODE_ENV !== "development") throw new Error("Development migration only");
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(`
    CREATE TABLE IF NOT EXISTS social_gift_bag_lots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id text NOT NULL REFERENCES account_profiles(account_id) ON DELETE CASCADE,
      gift_id text NOT NULL,
      quantity integer NOT NULL CHECK(quantity > 0),
      source text NOT NULL CHECK(source IN ('purchase','received','reward','legacy')),
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz,
      CHECK ((source = 'purchase' AND expires_at IS NOT NULL) OR (source <> 'purchase' AND expires_at IS NULL))
    );
    CREATE INDEX IF NOT EXISTS social_gift_bag_lots_account_gift_expiry
      ON social_gift_bag_lots(account_id, gift_id, expires_at);
    WITH remaining AS (
      SELECT b.account_id, b.gift_id,
        GREATEST(b.quantity - COALESCE(SUM(l.quantity), 0)::integer, 0) AS quantity
      FROM social_gift_bag b
      LEFT JOIN social_gift_bag_lots l
        ON l.account_id = b.account_id AND l.gift_id = b.gift_id
      GROUP BY b.account_id, b.gift_id, b.quantity
    ), purchases AS (
      SELECT r.account_id, r.gift_id, r.quantity AS available,
        p.created_at, ROW_NUMBER() OVER (
          PARTITION BY r.account_id, r.gift_id ORDER BY p.created_at, p.id
        ) AS purchase_number
      FROM remaining r
      JOIN social_ledger p ON p.account_id = r.account_id
        AND p.kind = 'purchase' AND p.ref_key = 'store-gift:' || r.gift_id
      WHERE r.quantity > 0
    )
    INSERT INTO social_gift_bag_lots(account_id, gift_id, quantity, source, created_at, expires_at)
      SELECT account_id, gift_id, 1, 'purchase', created_at, created_at + interval '7 days'
      FROM purchases WHERE purchase_number <= available;

    INSERT INTO social_gift_bag_lots(account_id, gift_id, quantity, source)
      SELECT b.account_id, b.gift_id,
        GREATEST(b.quantity - COALESCE(SUM(l.quantity), 0)::integer, 0), 'legacy'
      FROM social_gift_bag b
      LEFT JOIN social_gift_bag_lots l
        ON l.account_id = b.account_id AND l.gift_id = b.gift_id
      GROUP BY b.account_id, b.gift_id, b.quantity
      HAVING b.quantity > COALESCE(SUM(l.quantity), 0);
  `);
  await client.query("COMMIT");
  process.stdout.write("Added gift acquisition lots; existing bag quantities were preserved as non-expiring legacy inventory.\n");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
