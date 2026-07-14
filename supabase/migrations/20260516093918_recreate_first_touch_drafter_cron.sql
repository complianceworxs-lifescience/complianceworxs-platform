-- Recreate first-touch-drafter cron using the EXACT same pattern as the working followup-drafter cron
-- Schedule: 10:45 UTC = 6:45 AM EDT daily
-- Limit 20 leads per run (drafter has its own fit_score >= 80 floor)

SELECT cron.schedule(
  'first-touch-drafter-daily-645am-edt',
  '45 10 * * *',
  $$
  SELECT net.http_post(
    url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/first-touch-drafter?limit=20',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);