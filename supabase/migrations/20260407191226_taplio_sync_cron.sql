
SELECT cron.schedule(
  'taplio-prospect-sync',
  '0 */4 * * *',
  $$
    SELECT net.http_post(
      url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/taplio-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_key', true)
      ),
      body := '{}'::jsonb
    );
  $$
);
