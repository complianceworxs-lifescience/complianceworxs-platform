CREATE TABLE IF NOT EXISTS reconstruction_conversion_daily (
  id SERIAL PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_days INTEGER NOT NULL DEFAULT 7,
  completed INTEGER,
  routed INTEGER,
  reached_complete_file INTEGER,
  clicked_cta INTEGER,
  purchased INTEGER,
  route_to_buy_pct NUMERIC(5,2),
  buy_to_cta_pct NUMERIC(5,2),
  buy_to_purchase_pct NUMERIC(5,2),
  end_to_end_pct NUMERIC(5,2)
);
CREATE INDEX IF NOT EXISTS reconstruction_conversion_daily_captured_at_idx
  ON reconstruction_conversion_daily (captured_at DESC);

-- Schedule the monitor: daily at 5:20 AM EDT (5 min after the main conversion monitor)
SELECT cron.schedule(
  'reconstruction-conversion-monitor-daily-520am-edt',
  '20 9 * * *',
  $$SELECT net.http_post(
      url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/reconstruction-conversion-monitor',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );$$
);