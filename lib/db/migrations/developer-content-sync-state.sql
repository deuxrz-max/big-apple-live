CREATE TABLE IF NOT EXISTS developer_content_sync_state (
  id text PRIMARY KEY,
  last_synced_at timestamptz,
  last_scheduled_eastern_date text,
  summary jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
