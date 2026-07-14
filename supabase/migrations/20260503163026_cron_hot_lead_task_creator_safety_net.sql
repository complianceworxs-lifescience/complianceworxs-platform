SELECT cron.schedule(
  'hot-lead-task-creator-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_get(
    url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/hot-lead-task-creator?secret=3i_6DdFRT-EmxT0nczskfeA3HshAnu64w40C9-WmkAE&limit=20',
    timeout_milliseconds := 60000
  );
  $$
);