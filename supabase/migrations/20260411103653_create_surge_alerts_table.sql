
CREATE TABLE IF NOT EXISTS public.surge_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      text NOT NULL,
  email           text,
  full_name       text,
  company         text,
  attio_record_id text,
  pages_viewed    text[],
  event_count     integer NOT NULL DEFAULT 0,
  lead_score      integer,
  alerted_at      timestamptz NOT NULL DEFAULT now(),
  notification_channels text[] DEFAULT '{}',
  CONSTRAINT surge_alerts_session_unique UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS surge_alerts_alerted_at_idx ON surge_alerts (alerted_at DESC);
CREATE INDEX IF NOT EXISTS surge_alerts_session_idx ON surge_alerts (session_id);
