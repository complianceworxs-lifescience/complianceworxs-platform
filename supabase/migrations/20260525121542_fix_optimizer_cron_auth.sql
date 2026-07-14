-- Remove old cron entries and replace with correct no-auth version
SELECT cron.unschedule('outbound-optimizer-daily-4am-edt');
SELECT cron.unschedule('readiness-fallback-unlocker-daily-630am-edt');

SELECT cron.schedule(
  'outbound-optimizer-daily-4am-edt',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/outbound-optimizer',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

SELECT cron.schedule(
  'readiness-fallback-unlocker-daily-630am-edt',
  '30 10 * * *',
  $$
  UPDATE warm_outbound_staging
  SET
    readiness_status = 'ready',
    readiness_checked_at = NOW(),
    readiness_block_reasons = jsonb_build_array('fallback_no_personalization')
  WHERE fit_score >= 70
    AND readiness_status = 'pending_retry'
    AND archived_at IS NULL
    AND dm_drafted_at IS NULL
    AND readiness_checked_at < NOW() - INTERVAL '24 hours';
  $$
);