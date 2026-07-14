-- PF-1B CATCH-UP MIGRATION (out-of-band recovery)
-- These objects existed in production (project balkvbmtummehgbbeqap) but were
-- created outside the migration history (SQL editor/dashboard). Captured here from
-- their live definitions so the migration set fully reproduces production.
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP+CREATE): safe to re-apply.

SELECT cron.schedule('conversion-playbook-daily-8am-edt', '0 12 * * *', '
  SELECT net.http_post(
    url := ''https://balkvbmtummehgbbeqap.supabase.co/functions/v1/conversion-playbook'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || current_setting(''app.settings.service_role_key'', true)
    ),
    body := ''{}''::jsonb
  );
  ');

SELECT cron.schedule('gmail-linkedin-acceptance-watcher-15min', '*/15 * * * *', '
  SELECT net.http_get(
    url := ''https://balkvbmtummehgbbeqap.supabase.co/functions/v1/gmail-linkedin-acceptance-watcher'',
    headers := jsonb_build_object(''Content-Type'',''application/json'')
  );
  ');

SELECT cron.schedule('gmail-reply-poller-5min', '*/5 * * * *', ' SELECT net.http_get( url := ''https://balkvbmtummehgbbeqap.supabase.co/functions/v1/gmail-reply-poller'', timeout_milliseconds := 60000 ); ');

SELECT cron.schedule('page-price-audit-daily-505am-edt', '5 9 * * *', '
  SELECT net.http_post(
    url := ''https://balkvbmtummehgbbeqap.supabase.co/functions/v1/page-price-audit'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''service_role_key'' LIMIT 1)
    ),
    body := ''{}''::jsonb,
    timeout_milliseconds := 180000
  );
  ');

SELECT cron.schedule('partner-conversion-alerts', '*/5 * * * *', ' SELECT net.http_get(
       url := ''https://balkvbmtummehgbbeqap.supabase.co/functions/v1/partner-reporter/conversion-alerts?secret=3i_6DdFRT-EmxT0nczskfeA3HshAnu64w40C9-WmkAE'',
       timeout_milliseconds := 60000
     ); ');

SELECT cron.schedule('partner-monthly-statement', '0 13 1 * *', ' SELECT net.http_get(
       url := ''https://balkvbmtummehgbbeqap.supabase.co/functions/v1/partner-reporter/monthly-statement?secret=3i_6DdFRT-EmxT0nczskfeA3HshAnu64w40C9-WmkAE'',
       timeout_milliseconds := 120000
     ); ');

SELECT cron.schedule('partner-weekly-digest', '0 12 * * 1', ' SELECT net.http_get(
       url := ''https://balkvbmtummehgbbeqap.supabase.co/functions/v1/partner-reporter/weekly-digest?secret=3i_6DdFRT-EmxT0nczskfeA3HshAnu64w40C9-WmkAE'',
       timeout_milliseconds := 120000
     ); ');

SELECT cron.schedule('posthog-conversion-monitor-daily-515am-edt', '15 9 * * *', '
  SELECT net.http_post(
    url := ''https://balkvbmtummehgbbeqap.supabase.co/functions/v1/posthog-conversion-monitor'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || current_setting(''app.settings.service_role_key'', true)
    ),
    body := ''{}''::jsonb
  );
  ');

SELECT cron.schedule('stripe-orders-reconcile', '30 9 * * *', 'SELECT net.http_get(
    url := ''https://balkvbmtummehgbbeqap.supabase.co/functions/v1/stripe-orders-reconcile'',
    timeout_milliseconds := 60000
  );');

SELECT cron.schedule('stripe-sync-worker', '*/1 * * * *', '
        SELECT net.http_post(
          url := ''https://balkvbmtummehgbbeqap.supabase.co/functions/v1/stripe-worker'',
          headers := jsonb_build_object(
            ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''stripe_sync_worker_secret'')
          )
        )
        WHERE NOT EXISTS (
          SELECT 1 FROM vault.decrypted_secrets
          WHERE name = ''stripe_sync_skip_until''
            AND decrypted_secret::timestamptz > NOW()
        )
        ');

