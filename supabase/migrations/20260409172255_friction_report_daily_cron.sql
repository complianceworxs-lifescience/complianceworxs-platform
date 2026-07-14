
SELECT cron.schedule(
  'daily-friction-report-8am-est',
  '0 13 * * *',
  $$
  SELECT net.http_post(
    url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/send-friction-report',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
