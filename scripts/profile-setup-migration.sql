-- Additive only. Existing valid profile rows are complete; no completion reset.
BEGIN;
ALTER TABLE account_profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE account_profiles ADD COLUMN IF NOT EXISTS photo_url TEXT;
CREATE TABLE IF NOT EXISTS profile_photos (
 id UUID PRIMARY KEY,
 account_id TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE,
 size INTEGER NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profile_photos_owner_created ON profile_photos(account_id, created_at);
COMMIT;
