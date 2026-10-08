-- Additive only. Existing valid profile rows are complete; no completion reset.
BEGIN;
ALTER TABLE account_profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE account_profiles ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE account_profiles ADD COLUMN IF NOT EXISTS photo_urls TEXT[] NOT NULL DEFAULT '{}';
UPDATE account_profiles SET photo_urls = ARRAY[photo_url]
WHERE photo_url IS NOT NULL AND cardinality(photo_urls) = 0;
DO $$
BEGIN
  ALTER TABLE account_profiles DROP CONSTRAINT IF EXISTS account_profiles_three_photos;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_profiles_four_photos' AND conrelid = 'account_profiles'::regclass) THEN
    ALTER TABLE account_profiles ADD CONSTRAINT account_profiles_four_photos CHECK (cardinality(photo_urls) <= 4);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS profile_photos (
 id UUID PRIMARY KEY,
 account_id TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE,
 size INTEGER NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profile_photos_owner_created ON profile_photos(account_id, created_at);
COMMIT;
