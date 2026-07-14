
SELECT cron.schedule(
  'ghost-hunter-every-6h',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/push-bounces-to-clay',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
