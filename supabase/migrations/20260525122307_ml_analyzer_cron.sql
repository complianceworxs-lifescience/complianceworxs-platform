-- ML analyzer runs at 3:45 AM EDT (7:45 AM UTC) — 15 min before optimizer
SELECT cron.schedule(
  'outbound-ml-analyzer-daily-345am-edt',
  '45 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/outbound-ml-analyzer',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 180000
  );
  $$
);