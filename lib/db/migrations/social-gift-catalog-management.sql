CREATE TABLE IF NOT EXISTS social_gift_catalog_settings (
  gift_id text PRIMARY KEY,
  display_name text,
  cost integer,
  status text NOT NULL DEFAULT 'active',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_gift_catalog_cost_positive CHECK (cost IS NULL OR cost > 0),
  CONSTRAINT social_gift_catalog_status_check CHECK (status IN ('active', 'inactive', 'deleted'))
);

ALTER TABLE gift_studio_assets
  DROP CONSTRAINT IF EXISTS gift_studio_gift_id_check;
ALTER TABLE gift_studio_assets
  ADD CONSTRAINT gift_studio_gift_id_check
  CHECK (gift_id IN ('good-vibes','big-love','standing-ovation','heart','spirit-pup','moonfox','cosmic-encore','fireworks','rose-shower','whip'));
