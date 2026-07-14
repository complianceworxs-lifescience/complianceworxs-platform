
-- Run company-to-attio at :45 each hour
-- attio-dispatcher runs at :30, so this runs first, queuing records
-- dispatcher picks them up 15 minutes later on the next :30 run
SELECT cron.schedule(
  'company-to-attio-hourly',
  '45 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/company-to-attio',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
