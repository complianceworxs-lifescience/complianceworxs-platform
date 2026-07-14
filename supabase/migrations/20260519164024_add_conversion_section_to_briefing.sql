CREATE OR REPLACE VIEW public.session_start_briefing AS
WITH revenue AS (
  SELECT v_may2026_revenue.may_revenue_usd, v_may2026_revenue.may_target_usd, v_may2026_revenue.pct_to_target,
         v_may2026_revenue.lifetime_revenue_usd, v_may2026_revenue.may_orders, v_may2026_revenue.lifetime_orders,
         v_may2026_revenue.last_7d_revenue_usd, v_may2026_revenue.last_30d_revenue_usd, v_may2026_revenue.last_7d_orders,
         v_may2026_revenue.days_remaining_to_may31, v_may2026_revenue.required_daily_run_rate_usd
  FROM v_may2026_revenue
), unactioned_replies AS (
  SELECT count(*) AS count, min(replied_at) AS oldest_reply FROM warm_outbound_staging
  WHERE replied_at IS NOT NULL AND automation_paused = true AND automation_paused_reason ILIKE '%awaiting_human%'
), unactioned_dms AS (
  SELECT count(*) AS count, min(dm_replied_at) AS oldest_dm_reply FROM warm_outbound_staging
  WHERE dm_replied_at IS NOT NULL AND automation_paused = false AND followup_completed_at IS NULL
), form_submissions_no_outreach AS (
  SELECT count(*) AS count FROM form_submissions f
  WHERE f.created_at > (now() - INTERVAL '14 days') AND f.email NOT ILIKE '%complianceworxs%' AND f.email NOT ILIKE '%digital-360%'
    AND f.email NOT ILIKE '%digiital-360%' AND f.email NOT ILIKE '%gmai.com%' AND f.outreach_email_sent_at IS NULL
    AND (f.is_blocked IS NULL OR f.is_blocked = false)
    AND NOT EXISTS (SELECT 1 FROM gmail_send_log g WHERE g.recipient_email = f.email)
), overdue_followups AS (
  SELECT count(*) AS count FROM warm_outbound_staging
  WHERE next_followup_due_at < (now() - INTERVAL '24:00:00') AND followup_completed_at IS NULL
    AND replied_at IS NULL AND automation_paused = false
), last_intake AS (
  SELECT max(created_at) AS last_intake_at, now() - max(created_at) AS days_since_intake FROM warm_outbound_staging
), sends_today AS (
  SELECT count(*) AS count FROM gmail_send_log
  WHERE created_at::date = (now() AT TIME ZONE 'America/New_York')::date
), cron_health AS (
  WITH critical_jobs AS (
    SELECT jobid, jobname, schedule,
      CASE WHEN schedule = '*/5 * * * *' THEN 15
           WHEN schedule LIKE '%/15 * * * *' OR schedule = '5,20,35,50 * * * *' THEN 45
           WHEN schedule LIKE '0 % * * *' OR schedule LIKE '45 % * * *' OR schedule LIKE '30 % * * *' THEN 1500
           ELSE 180
      END AS stale_threshold_min
    FROM cron.job WHERE active = true AND jobname NOT ILIKE '%stripe%' AND jobname NOT ILIKE '%partner%'
  ), last_runs AS (
    SELECT jobid,
      max(end_time) FILTER (WHERE status = 'succeeded') AS last_success,
      count(*) FILTER (WHERE status = 'failed' AND start_time > now() - INTERVAL '24:00:00') AS failures_24h
    FROM cron.job_run_details WHERE start_time > now() - INTERVAL '7 days' GROUP BY jobid
  )
  SELECT cj.jobname,
    CASE WHEN lr.last_success IS NULL THEN 'NO_RUN_HISTORY'
         WHEN (EXTRACT(epoch FROM now() - lr.last_success) / 60) > cj.stale_threshold_min THEN 'STALE'
         WHEN lr.failures_24h > 0 THEN 'FAILING'
         ELSE 'HEALTHY'
    END AS health
  FROM critical_jobs cj LEFT JOIN last_runs lr ON lr.jobid = cj.jobid
), cron_summary AS (
  SELECT count(*) FILTER (WHERE health = 'HEALTHY') AS healthy,
         count(*) FILTER (WHERE health = 'NO_RUN_HISTORY') AS no_history,
         count(*) FILTER (WHERE health = 'STALE') AS stale,
         count(*) FILTER (WHERE health = 'FAILING') AS failing,
         count(*) AS total,
         string_agg(jobname, ', ') FILTER (WHERE health <> 'HEALTHY') AS unhealthy_jobs
  FROM cron_health
), pipeline_lag AS (
  SELECT
    (SELECT count(*) FROM warm_outbound_staging WHERE enrichment_status = 'enriched' AND email IS NOT NULL AND fit_score IS NULL AND enriched_at < now() - INTERVAL '02:00:00') AS fit_score_lag,
    (SELECT count(*) FROM warm_outbound_staging WHERE enrichment_status = 'pending' AND created_at < now() - INTERVAL '04:00:00') AS enrichment_lag,
    (SELECT count(*) FROM warm_outbound_staging WHERE fit_score >= 80 AND first_touch_draft_body IS NULL AND fit_scored_at IS NOT NULL AND fit_scored_at < now() - INTERVAL '24:00:00' AND automation_paused = false AND is_paying_customer IS NOT TRUE AND replied_at IS NULL AND dispatched_at IS NULL AND archived_at IS NULL) AS draft_lag,
    (SELECT count(*) FROM warm_outbound_staging WHERE first_touch_draft_body IS NOT NULL AND dispatched_at IS NULL AND first_touch_drafted_at < now() - INTERVAL '24:00:00' AND automation_paused = false AND is_paying_customer IS NOT TRUE AND replied_at IS NULL AND archived_at IS NULL) AS send_lag
), throughput AS (
  SELECT
    (SELECT count(*) FROM gmail_send_log WHERE created_at::date = (now() AT TIME ZONE 'America/New_York')::date) AS today,
    (SELECT round(count(*)::numeric / 7, 1) FROM gmail_send_log WHERE created_at > now() - INTERVAL '7 days') AS avg_7d,
    (SELECT count(*) FROM gmail_send_log WHERE created_at > now() - INTERVAL '24:00:00') AS last_24h
), scoring_throughput AS (
  SELECT
    (SELECT count(*) FROM warm_outbound_staging WHERE fit_scored_at::date = (now() AT TIME ZONE 'America/New_York')::date) AS scored_today,
    (SELECT round(count(*)::numeric / 7, 1) FROM warm_outbound_staging WHERE fit_scored_at > now() - INTERVAL '7 days') AS scored_avg_7d
), cron_failures AS (
  SELECT count(*) AS count FROM cron.job_run_details
  WHERE start_time > now() - INTERVAL '24:00:00' AND status = 'failed'
), alerts_summary AS (
  SELECT
    count(*) FILTER (WHERE severity = 'critical' AND resolved_at IS NULL) AS critical_unresolved,
    count(*) FILTER (WHERE severity = 'warning' AND resolved_at IS NULL) AS warning_unresolved,
    count(*) FILTER (WHERE created_at > now() - INTERVAL '24:00:00') AS alerts_24h,
    string_agg(DISTINCT alert_type, ', ') FILTER (WHERE resolved_at IS NULL AND severity IN ('critical', 'warning')) AS unresolved_types
  FROM system_alerts
), gmail_auth_health AS (
  SELECT
    max(checked_at) FILTER (WHERE refresh_succeeded = true) AS last_successful_auth,
    count(*) FILTER (WHERE checked_at > now() - INTERVAL '24:00:00' AND refresh_succeeded = false) AS auth_failures_24h,
    bool_or(audience_matches_env = false) FILTER (WHERE checked_at > now() - INTERVAL '24:00:00') AS credential_drift_detected,
    EXTRACT(epoch FROM now() - max(checked_at) FILTER (WHERE refresh_succeeded = true)) / 86400 AS days_since_last_success
  FROM gmail_auth_state
), conversion_snapshot AS (
  -- Pull the most recent PostHog conversion snapshot
  SELECT
    captured_at, case_file_views_unique, lock_views_unique, email_gate_shown_unique, email_gate_submitted,
    inline_gate_conversion_pct, universal_gate_shown, universal_gate_submitted, universal_gate_conversion_pct,
    main_gate_shown, main_gate_submitted, main_gate_conversion_pct, purchases_total, email_captures_total,
    lead_enrichment_failed, delta_vs_prior
  FROM posthog_conversion_daily ORDER BY captured_at DESC LIMIT 1
)
SELECT
  '=== CW SESSION BRIEFING ' || to_char(now() AT TIME ZONE 'America/New_York', 'YYYY-MM-DD HH24:MI EDT') || ' ===' ||
  E'\n\nREVENUE\n' ||
  '  May MTD: $' || COALESCE(round(r.may_revenue_usd, 2)::text, '0.00') || ' of $' || round(r.may_target_usd)::text ||
  ' (' || round(r.pct_to_target, 1)::text || '%)' || E'\n' ||
  '  Days remaining: ' || r.days_remaining_to_may31::text || ' | Required daily run rate: $' || round(r.required_daily_run_rate_usd, 2)::text || E'\n\n' ||

  -- CONVERSION SECTION (new)
  'CONVERSION (last 7d, PostHog)' || E'\n' ||
  CASE
    WHEN cs.captured_at IS NULL THEN '  No snapshot yet — first daily run at 5:15 AM EDT' || E'\n\n'
    ELSE
      '  Case file unique visitors: ' || cs.case_file_views_unique::text || E'\n' ||
      '  Inline gate: ' || cs.email_gate_submitted::text || '/' || cs.email_gate_shown_unique::text ||
      ' (' || COALESCE(cs.inline_gate_conversion_pct::text, '0') || '%)' || E'\n' ||
      '  Universal gate (cases): ' || cs.universal_gate_submitted::text || '/' || cs.universal_gate_shown::text ||
      ' (' || COALESCE(cs.universal_gate_conversion_pct::text, '0') || '%)' || E'\n' ||
      '  Main-site gate (homepage): ' || cs.main_gate_submitted::text || '/' || cs.main_gate_shown::text ||
      ' (' || COALESCE(cs.main_gate_conversion_pct::text, '0') || '%)' || E'\n' ||
      '  Total email captures: ' || cs.email_captures_total::text || ' | Purchases: ' || cs.purchases_total::text || E'\n' ||
      '  Snapshot age: ' || round(EXTRACT(epoch FROM now() - cs.captured_at) / 3600, 1)::text || 'h' || E'\n\n'
  END ||

  CASE WHEN als.critical_unresolved > 0 OR als.warning_unresolved > 0 THEN
    '🚨 UNRESOLVED ALERTS' || E'\n' ||
    CASE WHEN als.critical_unresolved > 0 THEN '  ❌ CRITICAL: ' || als.critical_unresolved::text || E'\n' ELSE '' END ||
    CASE WHEN als.warning_unresolved > 0 THEN '  ⚠ Warning: ' || als.warning_unresolved::text || E'\n' ELSE '' END ||
    CASE WHEN als.unresolved_types IS NOT NULL THEN '  Types: ' || als.unresolved_types || E'\n' ELSE '' END || E'\n'
    ELSE ''
  END ||

  'ROT FLAGS (data)' || E'\n' ||
  '  Unactioned replies (email): ' || ur.count::text ||
  CASE WHEN ur.oldest_reply IS NOT NULL THEN ' (oldest: ' || to_char(ur.oldest_reply AT TIME ZONE 'America/New_York', 'Mon DD') || ')' ELSE '' END || E'\n' ||
  '  Unactioned DM replies: ' || udm.count::text ||
  CASE WHEN udm.oldest_dm_reply IS NOT NULL THEN ' (oldest: ' || to_char(udm.oldest_dm_reply AT TIME ZONE 'America/New_York', 'Mon DD') || ')' ELSE '' END || E'\n' ||
  '  Form submissions with no outreach: ' || fsn.count::text || E'\n' ||
  '  Overdue followups (>24h, not paused, no reply): ' || of.count::text || E'\n' ||
  '  Edge function failures (24h): ' || cf.count::text || E'\n\n' ||

  'AUTOMATION HEALTH (crons)' || E'\n' ||
  '  Healthy: ' || cs2.healthy::text || ' / ' || cs2.total::text ||
  CASE WHEN cs2.no_history > 0 THEN ' | NO_RUN_HISTORY: ' || cs2.no_history::text ELSE '' END ||
  CASE WHEN cs2.stale > 0 THEN ' | STALE: ' || cs2.stale::text ELSE '' END ||
  CASE WHEN cs2.failing > 0 THEN ' | FAILING: ' || cs2.failing::text ELSE '' END || E'\n' ||
  CASE WHEN cs2.unhealthy_jobs IS NOT NULL THEN '  ⚠ Unhealthy: ' || cs2.unhealthy_jobs || E'\n' ELSE '' END || E'\n' ||

  'GMAIL AUTH' || E'\n' ||
  CASE
    WHEN gah.last_successful_auth IS NULL THEN '  ⚠ No auth attempts logged yet (table newly created — first batch will populate)' || E'\n'
    ELSE
      '  Last successful refresh: ' || to_char(gah.last_successful_auth AT TIME ZONE 'America/New_York', 'Mon DD HH24:MI') ||
      ' (' || round(gah.days_since_last_success, 1)::text || ' days ago)' || E'\n' ||
      '  Failures (24h): ' || COALESCE(gah.auth_failures_24h, 0)::text ||
      CASE WHEN gah.credential_drift_detected = true THEN ' | ❌ CREDENTIAL DRIFT DETECTED' ELSE '' END || E'\n' ||
      CASE WHEN gah.days_since_last_success > 150 THEN '  ⚠ Token age warning: > 150 days (Google revokes at 180)' || E'\n' ELSE '' END
  END || E'\n' ||

  'PIPELINE LAG (stuck between stages)' || E'\n' ||
  '  Enrichment lag (pending >4h): ' || pl.enrichment_lag::text || E'\n' ||
  '  Fit-score lag (enriched, no score >2h): ' || pl.fit_score_lag::text || E'\n' ||
  '  Draft lag (scored, no draft >24h): ' || pl.draft_lag::text || E'\n' ||
  '  Send lag (drafted, not sent >24h): ' || pl.send_lag::text || E'\n\n' ||

  'THROUGHPUT' || E'\n' ||
  '  Sends today: ' || tp.today::text || ' | Last 24h: ' || tp.last_24h::text || ' | 7d avg: ' || COALESCE(tp.avg_7d::text, '0') || E'\n' ||
  '  Fit scores today: ' || st.scored_today::text || ' | 7d avg: ' || COALESCE(st.scored_avg_7d::text, '0') || E'\n' ||
  '  Last lead intake: ' || to_char(li.last_intake_at AT TIME ZONE 'America/New_York', 'Mon DD HH24:MI') ||
  ' (' || EXTRACT(day FROM li.days_since_intake)::int::text || ' days ago)' || E'\n'
  AS briefing
FROM revenue r,
  unactioned_replies ur,
  unactioned_dms udm,
  form_submissions_no_outreach fsn,
  overdue_followups of,
  last_intake li,
  cron_failures cf,
  sends_today,
  cron_summary cs2,
  pipeline_lag pl,
  throughput tp,
  scoring_throughput st,
  alerts_summary als,
  gmail_auth_health gah
LEFT JOIN conversion_snapshot cs ON true;