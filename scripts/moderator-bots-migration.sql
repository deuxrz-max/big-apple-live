-- Additive only. Apply explicitly to development for this preview feature.
ALTER TABLE room_messages ADD COLUMN IF NOT EXISTS bot_id text;
CREATE TABLE IF NOT EXISTS moderator_bot_accounts (
  id text PRIMARY KEY, name text NOT NULL, avatar_url text NOT NULL
);
CREATE TABLE IF NOT EXISTS moderator_bot_settings (
  id text PRIMARY KEY, banned_words jsonb NOT NULL, break_seconds integer NOT NULL DEFAULT 45
);
CREATE TABLE IF NOT EXISTS moderator_bot_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
  warning_message_id uuid REFERENCES room_messages(id) ON DELETE SET NULL,
  room_id text NOT NULL, account_id text NOT NULL, username text NOT NULL,
  display_name text NOT NULL, reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz, reviewed_by text
);
CREATE INDEX IF NOT EXISTS moderator_bot_flags_created ON moderator_bot_flags(created_at);
