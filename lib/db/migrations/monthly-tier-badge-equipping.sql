-- Additive preview schema change for account badge selection.
ALTER TABLE social_settings
  ADD COLUMN IF NOT EXISTS equipped_badge_id text;

ALTER TABLE social_settings
  ADD COLUMN IF NOT EXISTS badge_equip_preference_set boolean NOT NULL DEFAULT false;
