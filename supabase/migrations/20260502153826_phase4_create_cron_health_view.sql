-- cron_health view: surfaces failing/stuck cron jobs
-- Used by system-health-check function to alert on broken automation.
CREATE OR REPLACE VIEW cron_health AS
WITH last_runs AS (
  SELECT
    j.jobid,
    j.jobname,
    j.schedule,
    j.active,
    (SELECT status FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1) AS last_status,
    (SELECT start_time FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1) AS last_run,
    (SELECT count(*) FROM cron.job_run_details d
       WHERE d.jobid = j.jobid AND d.start_time > now() - INTERVAL '24 hours' AND d.status = 'failed') AS failures_24h,
    (SELECT count(*) FROM cron.job_run_details d
       WHERE d.jobid = j.jobid AND d.start_time > now() - INTERVAL '24 hours') AS runs_24h
  FROM cron.job j
  WHERE j.active = true
)
SELECT
  jobid,
  jobname,
  schedule,
  last_status,
  last_run,
  failures_24h,
  runs_24h,
  CASE
    WHEN last_run IS NULL                                          THEN 'never_ran'
    WHEN last_status = 'failed'                                    THEN 'failing'
    WHEN failures_24h::numeric / GREATEST(runs_24h, 1)::numeric > 0.5  THEN 'flaky'
    WHEN last_run < now() - INTERVAL '6 hours' AND schedule LIKE '%* * * *%' THEN 'stalled'
    ELSE 'healthy'
  END AS health
FROM last_runs;

COMMENT ON VIEW cron_health IS 'Cron job health: healthy / flaky / failing / stalled / never_ran';