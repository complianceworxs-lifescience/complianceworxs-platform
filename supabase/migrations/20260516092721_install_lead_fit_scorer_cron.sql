-- Install the missing cron job: lead-fit-scorer runs every 15 minutes
-- Processes up to 20 enriched-but-unscored leads per run
-- Schedule: every 15 min, offset by 5 min from prospeo-linkedin-enrich (which runs at :00, :15, :30, :45)
-- This way enrichment finishes, then scoring picks up the result

SELECT cron.schedule(
  'lead-fit-scorer-15min',
  '5,20,35,50 * * * *',  -- every 15 min, offset +5 from enrichment
  $$
  SELECT net.http_post(
    url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/lead-fit-scorer?limit=20',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 60000
  );
  $$
);