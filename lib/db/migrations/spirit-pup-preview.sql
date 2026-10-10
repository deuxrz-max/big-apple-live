-- Additive development schema; never run on application startup or publish.
CREATE TABLE IF NOT EXISTS social_gift_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  history_id text NOT NULL,
  sender_id text REFERENCES account_profiles(account_id) ON DELETE SET NULL,
  recipient_id text REFERENCES account_profiles(account_id) ON DELETE SET NULL,
  sender_username text NOT NULL, recipient_username text NOT NULL,
  sender_name text NOT NULL, recipient_name text NOT NULL,
  gift_id text NOT NULL, cost integer NOT NULL,
  recipient_credits integer NOT NULL, house_credits integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_gift_split CHECK (cost > 0 AND recipient_credits >= 0 AND house_credits >= 0 AND cost = recipient_credits + house_credits)
);
CREATE INDEX IF NOT EXISTS social_gift_events_room_time ON social_gift_events(history_id, created_at);
CREATE TABLE IF NOT EXISTS social_gift_bag (
  account_id text NOT NULL REFERENCES account_profiles(account_id) ON DELETE CASCADE,
  gift_id text NOT NULL, quantity integer NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id, gift_id),
  CONSTRAINT social_gift_quantity CHECK(quantity > 0)
);
