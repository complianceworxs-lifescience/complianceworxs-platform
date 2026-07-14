
ALTER TABLE public.surge_alerts
  ADD COLUMN IF NOT EXISTS scheduled_for  timestamptz,
  ADD COLUMN IF NOT EXISTS attio_fired     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attio_fired_at  timestamptz;

CREATE INDEX IF NOT EXISTS surge_alerts_scheduled_idx
  ON surge_alerts (scheduled_for)
  WHERE attio_fired = false;
