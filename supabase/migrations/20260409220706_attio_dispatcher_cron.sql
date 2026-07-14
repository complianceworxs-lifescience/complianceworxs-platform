
SELECT cron.schedule(
  'attio-dispatcher-hourly',
  '30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/attio-dispatcher',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
