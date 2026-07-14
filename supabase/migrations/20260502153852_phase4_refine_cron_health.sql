CREATE OR REPLACE VIEW cron_health AS
WITH last_completed AS (
  SELECT
    j.jobid,
    j.jobname,
    j.schedule,
    j.active,
    (SELECT status FROM cron.job_run_details d
       WHERE d.jobid = j.jobid AND d.status IN ('succeeded','failed')
       ORDER BY d.start_time DESC LIMIT 1) AS last_status,
    (SELECT start_time FROM cron.job_run_details d
       WHERE d.jobid = j.jobid AND d.status IN ('succeeded','failed')
       ORDER BY d.start_time DESC LIMIT 1) AS last_run,
    (SELECT count(*) FROM cron.job_run_details d
       WHERE d.jobid = j.jobid
         AND d.start_time > now() - INTERVAL '24 hours'
         AND d.status = 'failed') AS failures_24h,
    (SELECT count(*) FROM cron.job_run_details d
       WHERE d.jobid = j.jobid
         AND d.start_time > now() - INTERVAL '24 hours'
         AND d.status IN ('succeeded','failed')) AS runs_24h
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
    WHEN last_run IS NULL AND runs_24h = 0                              THEN 'no_recent_runs'
    WHEN last_status = 'failed'                                         THEN 'failing'
    WHEN runs_24h > 0 AND failures_24h::numeric / runs_24h::numeric > 0.5  THEN 'flaky'
    WHEN last_run < now() - INTERVAL '90 minutes'
         AND schedule ~ '^\*/[0-9]+ \* \* \* \*$'                       THEN 'stalled_minutely'
    WHEN last_run < now() - INTERVAL '3 hours'
         AND schedule ~ '^[0-9]+ \* \* \* \*$'                          THEN 'stalled_hourly'
    ELSE 'healthy'
  END AS health
FROM last_completed;