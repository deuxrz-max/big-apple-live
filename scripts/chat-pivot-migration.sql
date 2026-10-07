-- Additive only. Do not rewrite, drop, backfill or expose legacy histories.
BEGIN;
CREATE TABLE IF NOT EXISTS chat_rooms (
 room_id text PRIMARY KEY, history_id uuid NOT NULL UNIQUE, label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), atmosphere jsonb);
CREATE TABLE IF NOT EXISTS chat_admissions (
 account_id text PRIMARY KEY, adult_confirmed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS chat_moderators (account_id text PRIMARY KEY);
ALTER TABLE chat_admissions ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS chat_memberships (
 history_id uuid NOT NULL REFERENCES chat_rooms(history_id),
 account_id text NOT NULL REFERENCES account_profiles(account_id),
 participant_id uuid NOT NULL DEFAULT gen_random_uuid(), muted boolean NOT NULL DEFAULT false,
 PRIMARY KEY(history_id, account_id));
CREATE TABLE IF NOT EXISTS chat_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), history_id uuid NOT NULL,
 room_id text NOT NULL, message_id uuid NOT NULL, reporter_id text NOT NULL,
 reason text NOT NULL, details text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'pending',
 reviewed_by text, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE room_messages ADD COLUMN IF NOT EXISTS author_account_id text;
ALTER TABLE room_messages ADD COLUMN IF NOT EXISTS hidden text NOT NULL DEFAULT 'false';
ALTER TABLE social_settings ADD COLUMN IF NOT EXISTS external_platform text;
ALTER TABLE social_settings ADD COLUMN IF NOT EXISTS external_handle text;
CREATE INDEX IF NOT EXISTS room_messages_account_created ON room_messages(author_account_id, created_at);
COMMIT;
