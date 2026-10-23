-- Additive only. No existing tables or account/wallet records are changed.
CREATE TABLE IF NOT EXISTS chess_rooms (
  id text PRIMARY KEY,
  game jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
