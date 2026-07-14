
SELECT cron.schedule(
  'high-intent-surge-every-2min',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/high-intent-surge',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
