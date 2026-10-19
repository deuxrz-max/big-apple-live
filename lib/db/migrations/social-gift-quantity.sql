-- Additive development migration: preserve every existing receipt as one gift.
ALTER TABLE social_gift_events
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

-- Monotonic room order makes cursor paging lossless even when timestamps tie.
ALTER TABLE social_gift_events
  ADD COLUMN IF NOT EXISTS event_order bigserial;

CREATE INDEX IF NOT EXISTS social_gift_events_room_sequence
  ON social_gift_events (history_id, event_order);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'social_gift_event_quantity'
      AND conrelid = 'social_gift_events'::regclass
  ) THEN
    ALTER TABLE social_gift_events
      ADD CONSTRAINT social_gift_event_quantity CHECK (quantity BETWEEN 1 AND 1314);
  END IF;
END $$;
