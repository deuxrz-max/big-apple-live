-- Development-only, additive Phase 3 migration. Existing rows are not rewritten.
BEGIN;
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS topic text;
ALTER TABLE social_messages ADD COLUMN IF NOT EXISTS whisper_history_id uuid REFERENCES chat_rooms(history_id);
CREATE INDEX IF NOT EXISTS social_message_whisper_history ON social_messages(whisper_history_id, created_at);
CREATE TABLE IF NOT EXISTS university_preferences (
  account_id text PRIMARY KEY REFERENCES account_profiles(account_id) ON DELETE CASCADE,
  rules_seen_at timestamptz
);
CREATE TABLE IF NOT EXISTS university_ignores (
  account_id text NOT NULL REFERENCES account_profiles(account_id) ON DELETE CASCADE,
  target_id text NOT NULL REFERENCES account_profiles(account_id) ON DELETE CASCADE,
  PRIMARY KEY(account_id, target_id),
  CHECK(account_id <> target_id)
);
COMMIT;
