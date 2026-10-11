CREATE TABLE IF NOT EXISTS streamer_passport_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL REFERENCES account_profiles(account_id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('liveme', 'tiktok', 'bigo', 'instagram', 'facebook', 'youtube', 'twitch')),
  handle text NOT NULL,
  profile_url text NOT NULL,
  verification_code text NOT NULL UNIQUE,
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'requested', 'verified')),
  added_at timestamptz NOT NULL DEFAULT now(),
  requested_at timestamptz,
  verified_at timestamptz,
  verified_by text
);
CREATE UNIQUE INDEX IF NOT EXISTS streamer_passport_account_platform
  ON streamer_passport_links(account_id, platform);
CREATE INDEX IF NOT EXISTS streamer_passport_review_queue
  ON streamer_passport_links(verification_status, requested_at);
CREATE TABLE IF NOT EXISTS streamer_passport_awards (
  account_id text PRIMARY KEY REFERENCES account_profiles(account_id) ON DELETE CASCADE,
  award_id text NOT NULL DEFAULT 'founding-league' CHECK (award_id = 'founding-league'),
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);
