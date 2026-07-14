-- Function deployment is handled via Supabase CLI / dashboard.
-- This migration logs the intent and adds a cron entry.
-- Cron fires daily at 1 AM EDT (5 AM UTC).

SELECT cron.schedule(
  'job-scraper-daily-1am-edt',
  '0 5 * * *',
  $$ SELECT net.http_get(
       url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/job-scraper?secret=3i_6DdFRT-EmxT0nczskfeA3HshAnu64w40C9-WmkAE',
       timeout_milliseconds := 300000
     ); $$
);