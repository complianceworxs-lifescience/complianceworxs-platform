-- Extend session_start_briefing with system_alerts + gmail_auth_state visibility
-- Adds: unresolved critical/warning alerts + Gmail auth health summary

CREATE OR REPLACE VIEW session_start_briefing AS
WITH revenue AS (
  SELECT may_revenue_usd, may_target_usd, pct_to_target, lifetime_revenue_usd,
    may_orders, lifetime_orders, last_7d_revenue_usd, last_30d_revenue_usd,
    last_7d_orders, days_remaining_to_may31, required_daily_run_rate_usd
  FROM v_may2026_revenue
),
unactioned_replies AS (
  SELECT count(*) AS count, min(replied_at) AS oldest_reply
  FROM warm_outbound_staging
  WHERE replied_at IS NOT NULL 
    AND automation_paused = true 
    AND automation_paused_reason ILIKE '%awaiting_human%'
),
unactioned_dms AS (
  SELECT count(*) AS count, min(dm_replied_at) AS oldest_dm_reply
  FROM warm_outbound_staging
  WHERE dm_replied_at IS NOT NULL 
    AND automation_paused = false
    AND followup_completed_at IS NULL
),
form_submissions_no_outreach AS (
  SELECT count(*) AS count
  FROM form_submissions f
  WHERE f.created_at > (now() - '14 days'::interval) 
    AND f.email NOT ILIKE '%complianceworxs%' 
    AND f.email NOT ILIKE '%digital-360%' 
    AND f.email NOT ILIKE '%digiital-360%' 
    AND f.email NOT ILIKE '%gmai.com%' 
    AND f.outreach_email_sent_at IS NULL 
    AND (f.is_blocked IS NULL OR f.is_blocked = FALSE)
    AND NOT EXISTS (SELECT 1 FROM gmail_send_log g WHERE g.recipient_email = f.email)
),
overdue_followups AS (
  SELECT count(*) AS count
  FROM warm_outbound_staging
  WHERE next_followup_due_at < (now() - '24:00:00'::interval) 
    AND followup_completed_at IS NULL 
    AND replied_at IS NULL 
    AND automation_paused = false
),
last_intake AS (
  SELECT max(created_at) AS last_intake_at, (now() - max(created_at)) AS days_since_intake
  FROM warm_outbound_staging
),
sends_today AS (
  SELECT count(*) AS count FROM gmail_send_log
  WHERE (created_at)::date = ((now() AT TIME ZONE 'America/New_York'::text))::date
),
cron_health AS (
  WITH critical_jobs AS (
    SELECT jobid, jobname, schedule,
      CASE 
        WHEN schedule = '*/5 * * * *' THEN 15
        WHEN schedule LIKE '%/15 * * * *' OR schedule = '5,20,35,50 * * * *' THEN 45
        WHEN schedule LIKE '0 % * * *' OR schedule LIKE '45 % * * *' OR schedule LIKE '30 % * * *' THEN 1500
        ELSE 180
      END as stale_threshold_min
    FROM cron.job
    WHERE active = TRUE
      AND jobname NOT ILIKE '%stripe%'
      AND jobname NOT ILIKE '%partner%'
  ),
  last_runs AS (
    SELECT jobid,
      MAX(end_time) FILTER (WHERE status = 'succeeded') as last_success,
      COUNT(*) FILTER (WHERE status = 'failed' AND start_time > NOW() - INTERVAL '24 hours') as failures_24h
    FROM cron.job_run_details
    WHERE start_time > NOW() - INTERVAL '7 days'
    GROUP BY jobid
  )
  SELECT 
    cj.jobname,
    CASE 
      WHEN lr.last_success IS NULL THEN 'NO_RUN_HISTORY'
      WHEN EXTRACT(EPOCH FROM (NOW() - lr.last_success))/60 > cj.stale_threshold_min THEN 'STALE'
      WHEN lr.failures_24h > 0 THEN 'FAILING'
      ELSE 'HEALTHY'
    END as health
  FROM critical_jobs cj
  LEFT JOIN last_runs lr ON lr.jobid = cj.jobid
),
cron_summary AS (
  SELECT 
    COUNT(*) FILTER (WHERE health = 'HEALTHY') as healthy,
    COUNT(*) FILTER (WHERE health = 'NO_RUN_HISTORY') as no_history,
    COUNT(*) FILTER (WHERE health = 'STALE') as stale,
    COUNT(*) FILTER (WHERE health = 'FAILING') as failing,
    COUNT(*) as total,
    string_agg(jobname, ', ') FILTER (WHERE health != 'HEALTHY') as unhealthy_jobs
  FROM cron_health
),
pipeline_lag AS (
  SELECT
    (SELECT COUNT(*) FROM warm_outbound_staging
     WHERE enrichment_status = 'enriched' AND email IS NOT NULL
       AND fit_score IS NULL AND enriched_at < NOW() - INTERVAL '2 hours') as fit_score_lag,
    (SELECT COUNT(*) FROM warm_outbound_staging
     WHERE enrichment_status = 'pending' AND created_at < NOW() - INTERVAL '4 hours') as enrichment_lag,
    (SELECT COUNT(*) FROM warm_outbound_staging
     WHERE fit_score >= 80 AND first_touch_draft_body IS NULL
       AND fit_scored_at IS NOT NULL AND fit_scored_at < NOW() - INTERVAL '24 hours'
       AND automation_paused = FALSE AND is_paying_customer IS NOT TRUE
       AND replied_at IS NULL) as draft_lag,
    (SELECT COUNT(*) FROM warm_outbound_staging
     WHERE first_touch_draft_body IS NOT NULL AND dispatched_at IS NULL
       AND first_touch_drafted_at < NOW() - INTERVAL '24 hours'
       AND automation_paused = FALSE AND is_paying_customer IS NOT TRUE
       AND replied_at IS NULL) as send_lag
),
throughput AS (
  SELECT 
    (SELECT COUNT(*) FROM gmail_send_log 
     WHERE created_at::date = ((NOW() AT TIME ZONE 'America/New_York')::date)) as today,
    (SELECT ROUND(COUNT(*)::numeric / 7, 1) FROM gmail_send_log 
     WHERE created_at > NOW() - INTERVAL '7 days') as avg_7d,
    (SELECT COUNT(*) FROM gmail_send_log 
     WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h
),
scoring_throughput AS (
  SELECT
    (SELECT COUNT(*) FROM warm_outbound_staging
     WHERE fit_scored_at::date = ((NOW() AT TIME ZONE 'America/New_York')::date)) as scored_today,
    (SELECT ROUND(COUNT(*)::numeric / 7, 1) FROM warm_outbound_staging
     WHERE fit_scored_at > NOW() - INTERVAL '7 days') as scored_avg_7d
),
cron_failures AS (
  SELECT count(*) AS count
  FROM cron.job_run_details
  WHERE start_time > (now() - '24:00:00'::interval) AND status = 'failed'
),

-- ============================================================================
-- NEW: SYSTEM ALERTS visibility
-- ============================================================================
alerts_summary AS (
  SELECT 
    COUNT(*) FILTER (WHERE severity = 'critical' AND resolved_at IS NULL) as critical_unresolved,
    COUNT(*) FILTER (WHERE severity = 'warning' AND resolved_at IS NULL) as warning_unresolved,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as alerts_24h,
    string_agg(DISTINCT alert_type, ', ') FILTER (WHERE resolved_at IS NULL AND severity IN ('critical', 'warning')) as unresolved_types
  FROM system_alerts
),

-- ============================================================================
-- NEW: GMAIL AUTH HEALTH visibility  
-- ============================================================================
gmail_auth_health AS (
  SELECT 
    MAX(checked_at) FILTER (WHERE refresh_succeeded = TRUE) as last_successful_auth,
    COUNT(*) FILTER (WHERE checked_at > NOW() - INTERVAL '24 hours' AND refresh_succeeded = FALSE) as auth_failures_24h,
    BOOL_OR(audience_matches_env = FALSE) FILTER (WHERE checked_at > NOW() - INTERVAL '24 hours') as credential_drift_detected,
    EXTRACT(EPOCH FROM (NOW() - MAX(checked_at) FILTER (WHERE refresh_succeeded = TRUE))) / 86400 as days_since_last_success
  FROM gmail_auth_state
)

SELECT (
  '=== CW SESSION BRIEFING '::text || to_char((now() AT TIME ZONE 'America/New_York'::text), 'YYYY-MM-DD HH24:MI EDT'::text) || ' ===' || E'\n\n' ||

  'REVENUE' || E'\n' ||
  '  May MTD: $' || COALESCE(round(r.may_revenue_usd, 2)::text, '0.00') || ' of $' || round(r.may_target_usd)::text || ' (' || round(r.pct_to_target, 1)::text || '%)' || E'\n' ||
  '  Days remaining: ' || r.days_remaining_to_may31::text || ' | Required daily run rate: $' || round(r.required_daily_run_rate_usd, 2)::text || E'\n\n' ||

  -- Show critical alerts ABOVE the fold when present
  CASE WHEN als.critical_unresolved > 0 OR als.warning_unresolved > 0 THEN
    '🚨 UNRESOLVED ALERTS' || E'\n' ||
    CASE WHEN als.critical_unresolved > 0 THEN '  ❌ CRITICAL: ' || als.critical_unresolved::text || E'\n' ELSE '' END ||
    CASE WHEN als.warning_unresolved > 0 THEN '  ⚠ Warning: ' || als.warning_unresolved::text || E'\n' ELSE '' END ||
    CASE WHEN als.unresolved_types IS NOT NULL THEN '  Types: ' || als.unresolved_types || E'\n' ELSE '' END ||
    E'\n'
  ELSE '' END ||

  'ROT FLAGS (data)' || E'\n' ||
  '  Unactioned replies (email): ' || ur.count::text ||
    CASE WHEN ur.oldest_reply IS NOT NULL THEN ' (oldest: ' || to_char((ur.oldest_reply AT TIME ZONE 'America/New_York'::text), 'Mon DD') || ')' ELSE '' END || E'\n' ||
  '  Unactioned DM replies: ' || udm.count::text ||
    CASE WHEN udm.oldest_dm_reply IS NOT NULL THEN ' (oldest: ' || to_char((udm.oldest_dm_reply AT TIME ZONE 'America/New_York'::text), 'Mon DD') || ')' ELSE '' END || E'\n' ||
  '  Form submissions with no outreach: ' || fsn.count::text || E'\n' ||
  '  Overdue followups (>24h, not paused, no reply): ' || of.count::text || E'\n' ||
  '  Edge function failures (24h): ' || cf.count::text || E'\n\n' ||

  'AUTOMATION HEALTH (crons)' || E'\n' ||
  '  Healthy: ' || cs.healthy::text || ' / ' || cs.total::text ||
  CASE WHEN cs.no_history > 0 THEN ' | NO_RUN_HISTORY: ' || cs.no_history::text ELSE '' END ||
  CASE WHEN cs.stale > 0 THEN ' | STALE: ' || cs.stale::text ELSE '' END ||
  CASE WHEN cs.failing > 0 THEN ' | FAILING: ' || cs.failing::text ELSE '' END || E'\n' ||
  CASE 
    WHEN cs.unhealthy_jobs IS NOT NULL THEN '  ⚠ Unhealthy: ' || cs.unhealthy_jobs || E'\n'
    ELSE ''
  END ||
  E'\n' ||

  'GMAIL AUTH' || E'\n' ||
  CASE 
    WHEN gah.last_successful_auth IS NULL THEN 
      '  ⚠ No auth attempts logged yet (table newly created — first batch will populate)' || E'\n'
    ELSE 
      '  Last successful refresh: ' || to_char((gah.last_successful_auth AT TIME ZONE 'America/New_York'::text), 'Mon DD HH24:MI') ||
        ' (' || ROUND(gah.days_since_last_success::numeric, 1)::text || ' days ago)' || E'\n' ||
      '  Failures (24h): ' || COALESCE(gah.auth_failures_24h, 0)::text ||
      CASE WHEN gah.credential_drift_detected = TRUE THEN ' | ❌ CREDENTIAL DRIFT DETECTED' ELSE '' END || E'\n' ||
      CASE 
        WHEN gah.days_since_last_success > 150 THEN '  ⚠ Token age warning: > 150 days (Google revokes at 180)' || E'\n'
        ELSE ''
      END
  END || E'\n' ||

  'PIPELINE LAG (stuck between stages)' || E'\n' ||
  '  Enrichment lag (pending >4h): ' || pl.enrichment_lag::text || E'\n' ||
  '  Fit-score lag (enriched, no score >2h): ' || pl.fit_score_lag::text || E'\n' ||
  '  Draft lag (scored, no draft >24h): ' || pl.draft_lag::text || E'\n' ||
  '  Send lag (drafted, not sent >24h): ' || pl.send_lag::text || E'\n\n' ||

  'THROUGHPUT' || E'\n' ||
  '  Sends today: ' || tp.today::text || ' | Last 24h: ' || tp.last_24h::text || ' | 7d avg: ' || COALESCE(tp.avg_7d::text, '0') || E'\n' ||
  '  Fit scores today: ' || st.scored_today::text || ' | 7d avg: ' || COALESCE(st.scored_avg_7d::text, '0') || E'\n' ||
  '  Last lead intake: ' || to_char((li.last_intake_at AT TIME ZONE 'America/New_York'::text), 'Mon DD HH24:MI') || ' (' || EXTRACT(day FROM li.days_since_intake)::integer::text || ' days ago)' || E'\n'
) AS briefing
FROM revenue r, unactioned_replies ur, unactioned_dms udm, form_submissions_no_outreach fsn, 
     overdue_followups of, last_intake li, cron_failures cf, sends_today,
     cron_summary cs, pipeline_lag pl, throughput tp, scoring_throughput st,
     alerts_summary als, gmail_auth_health gah;