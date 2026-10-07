-- Additive only. Every pre-existing unused upload receives a fresh grace period.
BEGIN;
ALTER TABLE profile_photos ADD COLUMN IF NOT EXISTS unused_since TIMESTAMPTZ DEFAULT now();
ALTER TABLE profile_photos ADD COLUMN IF NOT EXISTS deletion_started_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS profile_photos_retention ON profile_photos(unused_since);
COMMIT;
