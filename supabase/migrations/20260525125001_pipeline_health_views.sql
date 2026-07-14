-- PIPELINE HEALTH VIEWS
-- These are queryable from daily-brief, ad-hoc sessions, and the watchdog itself.
-- Intent: any session can run SELECT * FROM v_pipeline_health_summary and immediately
-- see what's broken without having to rediscover it from raw tables.

-- 1. Current health: latest watchdog check per dimension
CREATE OR REPLACE VIEW v_pipeline_health_summary AS
SELECT
  check_name,
  severity,
  affected_count,
  status,
  detail,
  checked_at,
  remediated_at,
  remediated_count,
  CASE
    WHEN status IN ('critical','degraded') AND severity = 'critical' THEN 1
    WHEN status = 'degraded' AND severity = 'warning' THEN 2
    WHEN status = 'manual_required' THEN 3
    ELSE 4
  END AS sort_order
FROM pipeline_health_current
ORDER BY sort_order, check_name;

-- 2. Drafted-but-unsent leads with their age (the recurring complaint)
CREATE OR REPLACE VIEW v_drafted_not_sent AS
SELECT
  id,
  full_name,
  company,
  job_title,
  fit_score,
  source,
  cohort_label,
  dm_status,
  linkedin_url IS NOT NULL AS has_linkedin,
  first_touch_drafted_at,
  EXTRACT(EPOCH FROM (NOW() - first_touch_drafted_at)) / 3600 AS hours_since_drafted,
  CASE
    WHEN cohort_label ILIKE '%1st-degree%' OR source ILIKE '%1st-degree%' OR source ILIKE '%1st_degree%'
    THEN 'warm_1st_degree'
    ELSE 'cold_outreach'
  END AS dispatch_route
FROM warm_outbound_staging
WHERE first_touch_draft_body IS NOT NULL
  AND dm_connection_request_sent_at IS NULL
  AND archived_at IS NULL
  AND automation_paused = false
  AND is_paying_customer = false
  AND linkedin_url IS NOT NULL
  AND (dm_status IS NULL OR dm_status NOT IN (
    'sent_manual','disqualified','warm_queued',
    'connect_request_queued','sent_manual_backfilled'
  ))
ORDER BY fit_score DESC NULLS LAST;

-- 3. Cron health: last run per job with silence alert
CREATE OR REPLACE VIEW v_cron_health AS
SELECT
  j.jobname,
  j.schedule,
  j.active,
  MAX(r.end_time) AS last_ran,
  COUNT(CASE WHEN r.status = 'failed' THEN 1 END) AS failures_7d,
  COUNT(CASE WHEN r.status = 'succeeded' THEN 1 END) AS successes_7d,
  CASE
    WHEN MAX(r.end_time) IS NULL THEN 'never_run'
    WHEN MAX(r.end_time) < NOW() - INTERVAL '2 hours'
      AND j.schedule LIKE '*/1%' THEN 'silent'
    WHEN MAX(r.end_time) < NOW() - INTERVAL '30 minutes'
      AND (j.schedule LIKE '*/5%' OR j.schedule LIKE '*/15%') THEN 'silent'
    WHEN MAX(r.end_time) < NOW() - INTERVAL '2 hours'
      AND j.jobname LIKE '%-15min%' THEN 'silent'
    ELSE 'ok'
  END AS health_status
FROM cron.job j
LEFT JOIN cron.job_run_details r
  ON r.jobid = j.jobid
  AND r.start_time > NOW() - INTERVAL '7 days'
GROUP BY j.jobid, j.jobname, j.schedule, j.active
ORDER BY health_status DESC, last_ran DESC NULLS FIRST;

-- 4. Stuck leads: leads that should have moved but haven't
CREATE OR REPLACE VIEW v_stuck_leads AS
SELECT 'stuck_enriching' AS issue, id, full_name, company, fit_score,
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS hours_stuck,
  enrichment_status AS current_status, NULL AS dm_status
FROM warm_outbound_staging
WHERE enrichment_status = 'enriching'
  AND enriched_at IS NULL
  AND archived_at IS NULL
  AND created_at < NOW() - INTERVAL '2 hours'

UNION ALL

SELECT 'accepted_no_message', id, full_name, company, fit_score,
  EXTRACT(EPOCH FROM (NOW() - dm_connection_accepted_at)) / 3600,
  NULL, dm_status
FROM warm_outbound_staging
WHERE dm_connection_accepted_at IS NOT NULL
  AND dm_first_message_sent_at IS NULL
  AND archived_at IS NULL
  AND dm_connection_accepted_at < NOW() - INTERVAL '3 days'

ORDER BY hours_stuck DESC;

COMMENT ON VIEW v_pipeline_health_summary IS 'Current pipeline health per watchdog check dimension. Start every session with SELECT * FROM v_pipeline_health_summary.';
COMMENT ON VIEW v_drafted_not_sent IS 'Drafted leads not yet dispatched. Should be empty within 24h of draft. Recurring failure surface.';
COMMENT ON VIEW v_cron_health IS 'Cron job health with silence detection. Any row with health_status=silent needs investigation.';
COMMENT ON VIEW v_stuck_leads IS 'Leads stuck in enrichment or accepted connections with no follow-up.';
