CREATE TABLE IF NOT EXISTS live_stream_sessions (
  account_id text PRIMARY KEY,
  stream_id text NOT NULL UNIQUE,
  state text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
