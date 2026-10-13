CREATE TABLE IF NOT EXISTS community_video_pools (
  room_id text PRIMARY KEY,
  videos jsonb NOT NULL DEFAULT '[]'::jsonb,
  term_index integer NOT NULL DEFAULT 0,
  page_tokens jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_cursors jsonb NOT NULL DEFAULT '{}'::jsonb,
  refreshed_at timestamptz,
  last_attempt_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_video_play_history (
  room_id text NOT NULL,
  video_id text NOT NULL,
  last_played_at timestamptz NOT NULL,
  play_count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (room_id, video_id)
);

CREATE INDEX IF NOT EXISTS community_video_play_history_last_played_idx
  ON community_video_play_history (room_id, last_played_at);

CREATE TABLE IF NOT EXISTS youtube_api_daily_quota (
  utc_date date PRIMARY KEY,
  units integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS youtube_api_room_daily_quota (
  utc_date date NOT NULL,
  room_id text NOT NULL,
  units integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (utc_date, room_id)
);
