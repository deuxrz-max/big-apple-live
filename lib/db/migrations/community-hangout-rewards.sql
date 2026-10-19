CREATE TABLE IF NOT EXISTS community_hangout_settings (
  id integer PRIMARY KEY DEFAULT 1,
  average_drop_interval_minutes integer NOT NULL DEFAULT 60,
  next_drop_at timestamptz NOT NULL DEFAULT now(),
  last_drop_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_hangout_settings_singleton CHECK (id = 1),
  CONSTRAINT community_hangout_settings_interval CHECK (average_drop_interval_minutes BETWEEN 15 AND 360)
);

CREATE TABLE IF NOT EXISTS community_seat_sessions (
  account_id text NOT NULL REFERENCES account_profiles(account_id) ON DELETE CASCADE,
  room_id text NOT NULL,
  participant_id uuid NOT NULL,
  seated_since timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_seat_sessions_pk PRIMARY KEY (account_id, room_id)
);
CREATE INDEX IF NOT EXISTS community_seat_sessions_room_since
  ON community_seat_sessions(room_id, seated_since);

CREATE TABLE IF NOT EXISTS community_coin_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  amount integer NOT NULL CHECK (amount BETWEEN 1 AND 100),
  started_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_coin_drops_room_started
  ON community_coin_drops(room_id, started_at DESC);

CREATE TABLE IF NOT EXISTS community_coin_drop_claims (
  drop_id uuid NOT NULL REFERENCES community_coin_drops(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES account_profiles(account_id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount BETWEEN 1 AND 100),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_coin_drop_claims_pk PRIMARY KEY (drop_id, account_id)
);

CREATE TABLE IF NOT EXISTS community_hangout_streaks (
  account_id text PRIMARY KEY REFERENCES account_profiles(account_id) ON DELETE CASCADE,
  last_qualified_day text NOT NULL,
  consecutive_days integer NOT NULL DEFAULT 1 CHECK (consecutive_days BETWEEN 1 AND 7),
  last_reward_day text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
