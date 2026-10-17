CREATE TABLE IF NOT EXISTS social_gift_catalog_settings (
  gift_id text PRIMARY KEY,
  display_name text,
  cost integer,
  product_type text NOT NULL DEFAULT 'gift',
  status text NOT NULL DEFAULT 'active',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_gift_catalog_cost_positive CHECK (cost IS NULL OR cost > 0),
  CONSTRAINT social_gift_catalog_product_type_check CHECK (product_type IN ('gift', 'entrance-effect')),
  CONSTRAINT social_gift_catalog_status_check CHECK (status IN ('active', 'inactive', 'deleted'))
);

ALTER TABLE social_gift_catalog_settings
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'gift';
ALTER TABLE social_gift_catalog_settings
  DROP CONSTRAINT IF EXISTS social_gift_catalog_product_type_check;
ALTER TABLE social_gift_catalog_settings
  ADD CONSTRAINT social_gift_catalog_product_type_check
  CHECK (product_type IN ('gift', 'entrance-effect'));

ALTER TABLE social_settings
  ADD COLUMN IF NOT EXISTS equipped_entrance_effect_id text;

ALTER TABLE gift_studio_assets
  DROP CONSTRAINT IF EXISTS gift_studio_assets_gift_id_check;
ALTER TABLE gift_studio_assets
  DROP CONSTRAINT IF EXISTS gift_studio_gift_id_check;
ALTER TABLE gift_studio_assets
  ADD CONSTRAINT gift_studio_gift_id_check
  CHECK (gift_id IS NULL OR gift_id IN ('good-vibes','big-love','standing-ovation','heart','spirit-pup','moonfox','cosmic-encore','fireworks','rose-shower','whip') OR gift_id ~ '^studio-[0-9a-f-]{36}$');
