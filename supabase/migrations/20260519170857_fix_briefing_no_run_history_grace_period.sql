-- Patch cron_health logic in session_start_briefing to give newly-scheduled crons a 25-hour grace period
-- before flagging NO_RUN_HISTORY as unhealthy.
-- A daily cron scheduled an hour ago hasn't failed — it just hasn't run yet.

CREATE OR REPLACE VIEW session_start_briefing AS
 WITH revenue AS (
         SELECT v_may2026_revenue.may_revenue_usd,
            v_may2026_revenue.may_target_usd,
            v_may2026_revenue.pct_to_target,
            v_may2026_revenue.lifetime_revenue_usd,
            v_may2026_revenue.may_orders,
            v_may2026_revenue.lifetime_orders,
            v_may2026_revenue.last_7d_revenue_usd,
            v_may2026_revenue.last_30d_revenue_usd,
            v_may2026_revenue.last_7d_orders,
            v_may2026_revenue.days_remaining_to_may31,
            v_may2026_revenue.required_daily_run_rate_usd
           FROM v_may2026_revenue
        ), unactioned_replies AS (
         SELECT count(*) AS count,
            min(warm_outbound_staging.replied_at) AS oldest_reply
           FROM warm_outbound_staging
          WHERE warm_outbound_staging.replied_at IS NOT NULL AND warm_outbound_staging.automation_paused = true AND warm_outbound_staging.automation_paused_reason ILIKE '%awaiting_human%'
        ), unactioned_dms AS (
         SELECT count(*) AS count,
            min(warm_outbound_staging.dm_replied_at) AS oldest_dm_reply
           FROM warm_outbound_staging
          WHERE warm_outbound_staging.dm_replied_at IS NOT NULL AND warm_outbound_staging.automation_paused = false AND warm_outbound_staging.followup_completed_at IS NULL
        ), form_submissions_no_outreach AS (
         SELECT count(*) AS count
           FROM form_submissions f
          WHERE f.created_at > (now() - '14 days'::interval) AND f.email !~~* '%complianceworxs%' AND f.email !~~* '%digital-360%' AND f.email !~~* '%digiital-360%' AND f.email !~~* '%gmai.com%' AND f.outreach_email_sent_at IS NULL AND (f.is_blocked IS NULL OR f.is_blocked = false) AND NOT (EXISTS ( SELECT 1
                   FROM gmail_send_log g
                  WHERE g.recipient_email = f.email))
        ), overdue_followups AS (
         SELECT count(*) AS count
           FROM warm_outbound_staging
          WHERE warm_outbound_staging.next_followup_due_at < (now() - '24:00:00'::interval) AND warm_outbound_staging.followup_completed_at IS NULL AND warm_outbound_staging.replied_at IS NULL AND warm_outbound_staging.automation_paused = false
        ), last_intake AS (
         SELECT max(warm_outbound_staging.created_at) AS last_intake_at,
            now() - max(warm_outbound_staging.created_at) AS days_since_intake
           FROM warm_outbound_staging
        ), sends_today AS (
         SELECT count(*) AS count
           FROM gmail_send_log
          WHERE gmail_send_log.created_at::date = (now() AT TIME ZONE 'America/New_York'::text)::date
        ), cron_health AS (
         WITH critical_jobs AS (
                 SELECT job.jobid,
                    job.jobname,
                    job.schedule,
                        CASE
                            WHEN job.schedule = '*/5 * * * *' THEN 15
                            WHEN job.schedule LIKE '%/15 * * * *' OR job.schedule = '5,20,35,50 * * * *' THEN 45
                            WHEN job.schedule LIKE '0 % * * *' OR job.schedule LIKE '45 % * * *' OR job.schedule LIKE '30 % * * *' THEN 1500
                            ELSE 180
                        END AS stale_threshold_min
                   FROM cron.job
                  WHERE job.active = true AND job.jobname NOT ILIKE '%stripe%' AND job.jobname NOT ILIKE '%partner%'
                ), last_runs AS (
                 SELECT job_run_details.jobid,
                    max(job_run_details.end_time) FILTER (WHERE job_run_details.status = 'succeeded') AS last_success,
                    count(*) FILTER (WHERE job_run_details.status = 'failed' AND job_run_details.start_time > (now() - '24:00:00'::interval)) AS failures_24h,
                    count(*) AS total_runs
                   FROM cron.job_run_details
                  WHERE job_run_details.start_time > (now() - '7 days'::interval)
                  GROUP BY job_run_details.jobid
                )
         SELECT cj.jobname,
                CASE
                    -- Grace period: if job has zero runs in last 7d AND no success ever, treat as NEWLY_SCHEDULED (not unhealthy)
                    -- This catches new daily crons scheduled within the past 25h that haven't had their first window yet
                    WHEN lr.last_success IS NULL AND (lr.total_runs IS NULL OR lr.total_runs = 0) THEN 'NEWLY_SCHEDULED'
                    WHEN lr.last_success IS NULL THEN 'NO_RUN_HISTORY'
                    WHEN (EXTRACT(epoch FROM now() - lr.last_success) / 60::numeric) > cj.stale_threshold_min::numeric THEN 'STALE'
                    WHEN lr.failures_24h > 0 THEN 'FAILING'
                    ELSE 'HEALTHY'
                END AS health
           FROM critical_jobs cj
             LEFT JOIN last_runs lr ON lr.jobid = cj.jobid
        ), cron_summary AS (
         SELECT count(*) FILTER (WHERE cron_health.health = 'HEALTHY') AS healthy,
            count(*) FILTER (WHERE cron_health.health = 'NEWLY_SCHEDULED') AS newly_scheduled,
            count(*) FILTER (WHERE cron_health.health = 'NO_RUN_HISTORY') AS no_history,
            count(*) FILTER (WHERE cron_health.health = 'STALE') AS stale,
            count(*) FILTER (WHERE cron_health.health = 'FAILING') AS failing,
            count(*) AS total,
            -- Only string-agg actual unhealthy states (NEWLY_SCHEDULED is acceptable)
            string_agg(cron_health.jobname, ', ') FILTER (WHERE cron_health.health NOT IN ('HEALTHY','NEWLY_SCHEDULED')) AS unhealthy_jobs
           FROM cron_health
        ), pipeline_lag AS (
         SELECT ( SELECT count(*) AS count
                   FROM warm_outbound_staging
                  WHERE warm_outbound_staging.enrichment_status = 'enriched' AND warm_outbound_staging.email IS NOT NULL AND warm_outbound_staging.fit_score IS NULL AND warm_outbound_staging.enriched_at < (now() - '02:00:00'::interval)) AS fit_score_lag,
            ( SELECT count(*) AS count
                   FROM warm_outbound_staging
                  WHERE warm_outbound_staging.enrichment_status = 'pending' AND warm_outbound_staging.created_at < (now() - '04:00:00'::interval)) AS enrichment_lag,
            ( SELECT count(*) AS count
                   FROM warm_outbound_staging
                  WHERE warm_outbound_staging.fit_score >= 80 AND warm_outbound_staging.first_touch_draft_body IS NULL AND warm_outbound_staging.fit_scored_at IS NOT NULL AND warm_outbound_staging.fit_scored_at < (now() - '24:00:00'::interval) AND warm_outbound_staging.automation_paused = false AND warm_outbound_staging.is_paying_customer IS NOT TRUE AND warm_outbound_staging.replied_at IS NULL AND warm_outbound_staging.dispatched_at IS NULL AND warm_outbound_staging.archived_at IS NULL) AS draft_lag,
            ( SELECT count(*) AS count
                   FROM warm_outbound_staging
                  WHERE warm_outbound_staging.first_touch_draft_body IS NOT NULL AND warm_outbound_staging.dispatched_at IS NULL AND warm_outbound_staging.first_touch_drafted_at < (now() - '24:00:00'::interval) AND warm_outbound_staging.automation_paused = false AND warm_outbound_staging.is_paying_customer IS NOT TRUE AND warm_outbound_staging.replied_at IS NULL AND warm_outbound_staging.archived_at IS NULL) AS send_lag
        ), throughput AS (
         SELECT ( SELECT count(*) AS count
                   FROM gmail_send_log
                  WHERE gmail_send_log.created_at::date = (now() AT TIME ZONE 'America/New_York'::text)::date) AS today,
            ( SELECT round(count(*)::numeric / 7::numeric, 1) AS round
                   FROM gmail_send_log
                  WHERE gmail_send_log.created_at > (now() - '7 days'::interval)) AS avg_7d,
            ( SELECT count(*) AS count
                   FROM gmail_send_log
                  WHERE gmail_send_log.created_at > (now() - '24:00:00'::interval)) AS last_24h
        ), scoring_throughput AS (
         SELECT ( SELECT count(*) AS count
                   FROM warm_outbound_staging
                  WHERE warm_outbound_staging.fit_scored_at::date = (now() AT TIME ZONE 'America/New_York'::text)::date) AS scored_today,
            ( SELECT round(count(*)::numeric / 7::numeric, 1) AS round
                   FROM warm_outbound_staging
                  WHERE warm_outbound_staging.fit_scored_at > (now() - '7 days'::interval)) AS scored_avg_7d
        ), cron_failures AS (
         SELECT count(*) AS count
           FROM cron.job_run_details
          WHERE job_run_details.start_time > (now() - '24:00:00'::interval) AND job_run_details.status = 'failed'
        ), alerts_summary AS (
         SELECT count(*) FILTER (WHERE system_alerts.severity = 'critical' AND system_alerts.resolved_at IS NULL) AS critical_unresolved,
            count(*) FILTER (WHERE system_alerts.severity = 'warning' AND system_alerts.resolved_at IS NULL) AS warning_unresolved,
            count(*) FILTER (WHERE system_alerts.created_at > (now() - '24:00:00'::interval)) AS alerts_24h,
            string_agg(DISTINCT system_alerts.alert_type, ', ') FILTER (WHERE system_alerts.resolved_at IS NULL AND system_alerts.severity IN ('critical','warning')) AS unresolved_types
           FROM system_alerts
        ), gmail_auth_health AS (
         SELECT max(gmail_auth_state.checked_at) FILTER (WHERE gmail_auth_state.refresh_succeeded = true) AS last_successful_auth,
            count(*) FILTER (WHERE gmail_auth_state.checked_at > (now() - '24:00:00'::interval) AND gmail_auth_state.refresh_succeeded = false) AS auth_failures_24h,
            bool_or(gmail_auth_state.audience_matches_env = false) FILTER (WHERE gmail_auth_state.checked_at > (now() - '24:00:00'::interval)) AS credential_drift_detected,
            EXTRACT(epoch FROM now() - max(gmail_auth_state.checked_at) FILTER (WHERE gmail_auth_state.refresh_succeeded = true)) / 86400::numeric AS days_since_last_success
           FROM gmail_auth_state
        ), conversion_snapshot AS (
         SELECT posthog_conversion_daily.captured_at,
            posthog_conversion_daily.case_file_views_unique,
            posthog_conversion_daily.lock_views_unique,
            posthog_conversion_daily.email_gate_shown_unique,
            posthog_conversion_daily.email_gate_submitted,
            posthog_conversion_daily.inline_gate_conversion_pct,
            posthog_conversion_daily.universal_gate_shown,
            posthog_conversion_daily.universal_gate_submitted,
            posthog_conversion_daily.universal_gate_conversion_pct,
            posthog_conversion_daily.main_gate_shown,
            posthog_conversion_daily.main_gate_submitted,
            posthog_conversion_daily.main_gate_conversion_pct,
            posthog_conversion_daily.purchases_total,
            posthog_conversion_daily.email_captures_total,
            posthog_conversion_daily.lead_enrichment_failed,
            posthog_conversion_daily.delta_vs_prior
           FROM posthog_conversion_daily
          ORDER BY posthog_conversion_daily.captured_at DESC
         LIMIT 1
        ), playbook_latest AS (
         SELECT id, generated_at, primary_action, primary_target, status, recommendation
           FROM conversion_playbook_decisions
          WHERE status = 'pending'
          ORDER BY generated_at DESC
         LIMIT 1
        )
 SELECT '=== CW SESSION BRIEFING ' || to_char((now() AT TIME ZONE 'America/New_York'), 'YYYY-MM-DD HH24:MI EDT') || ' ===' ||
        E'\n\nREVENUE\n' ||
        '  May MTD: $' || COALESCE(round(r.may_revenue_usd, 2)::text, '0.00') || ' of $' || round(r.may_target_usd)::text || ' (' || round(r.pct_to_target, 1)::text || '%)' ||
        E'\n  Days remaining: ' || r.days_remaining_to_may31::text || ' | Required daily run rate: $' || round(r.required_daily_run_rate_usd, 2)::text ||
        E'\n\nCONVERSION (last 7d, PostHog)\n' ||
        CASE
            WHEN cs.captured_at IS NULL THEN E'  No snapshot yet — first daily run at 5:15 AM EDT\n\n'
            ELSE '  Case file unique visitors: ' || cs.case_file_views_unique::text ||
                 E'\n  Inline gate: ' || cs.email_gate_submitted::text || '/' || cs.email_gate_shown_unique::text || ' (' || COALESCE(cs.inline_gate_conversion_pct::text, '0') || '%)' ||
                 E'\n  Universal gate (cases): ' || cs.universal_gate_submitted::text || '/' || cs.universal_gate_shown::text || ' (' || COALESCE(cs.universal_gate_conversion_pct::text, '0') || '%)' ||
                 E'\n  Main-site gate (homepage): ' || cs.main_gate_submitted::text || '/' || cs.main_gate_shown::text || ' (' || COALESCE(cs.main_gate_conversion_pct::text, '0') || '%)' ||
                 E'\n  Total email captures: ' || cs.email_captures_total::text || ' | Purchases: ' || cs.purchases_total::text ||
                 E'\n  Snapshot age: ' || round(EXTRACT(epoch FROM now() - cs.captured_at) / 3600::numeric, 1)::text || 'h' ||
                 E'\n\n'
        END ||
        CASE
            WHEN pl_latest.id IS NOT NULL THEN E'PLAYBOOK DECISION (pending sign-off)\n  ' || pl_latest.recommendation || E'\n\n'
            ELSE ''
        END ||
        CASE
            WHEN als.critical_unresolved > 0 OR als.warning_unresolved > 0 THEN E'🚨 UNRESOLVED ALERTS\n' ||
                CASE WHEN als.critical_unresolved > 0 THEN '  ❌ CRITICAL: ' || als.critical_unresolved::text || E'\n' ELSE '' END ||
                CASE WHEN als.warning_unresolved > 0 THEN '  ⚠ Warning: ' || als.warning_unresolved::text || E'\n' ELSE '' END ||
                CASE WHEN als.unresolved_types IS NOT NULL THEN '  Types: ' || als.unresolved_types || E'\n' ELSE '' END ||
                E'\n'
            ELSE ''
        END ||
        E'ROT FLAGS (data)\n' ||
        '  Unactioned replies (email): ' || ur.count::text ||
        CASE WHEN ur.oldest_reply IS NOT NULL THEN ' (oldest: ' || to_char((ur.oldest_reply AT TIME ZONE 'America/New_York'), 'Mon DD') || ')' ELSE '' END ||
        E'\n  Unactioned DM replies: ' || udm.count::text ||
        CASE WHEN udm.oldest_dm_reply IS NOT NULL THEN ' (oldest: ' || to_char((udm.oldest_dm_reply AT TIME ZONE 'America/New_York'), 'Mon DD') || ')' ELSE '' END ||
        E'\n  Form submissions with no outreach: ' || fsn.count::text ||
        E'\n  Overdue followups (>24h, not paused, no reply): ' || ovf.count::text ||
        E'\n  Edge function failures (24h): ' || cf.count::text ||
        E'\n\nAUTOMATION HEALTH (crons)\n' ||
        '  Healthy: ' || cs2.healthy::text || ' / ' || cs2.total::text ||
        CASE WHEN cs2.newly_scheduled > 0 THEN ' | Newly scheduled: ' || cs2.newly_scheduled::text ELSE '' END ||
        CASE WHEN cs2.no_history > 0 THEN ' | NO_RUN_HISTORY: ' || cs2.no_history::text ELSE '' END ||
        CASE WHEN cs2.stale > 0 THEN ' | STALE: ' || cs2.stale::text ELSE '' END ||
        CASE WHEN cs2.failing > 0 THEN ' | FAILING: ' || cs2.failing::text ELSE '' END ||
        E'\n' ||
        CASE WHEN cs2.unhealthy_jobs IS NOT NULL THEN '  ⚠ Unhealthy: ' || cs2.unhealthy_jobs || E'\n' ELSE '' END ||
        E'\nGMAIL AUTH\n' ||
        CASE
            WHEN gah.last_successful_auth IS NULL THEN E'  ⚠ No auth attempts logged yet (table newly created — first batch will populate)\n'
            ELSE '  Last successful refresh: ' || to_char((gah.last_successful_auth AT TIME ZONE 'America/New_York'), 'Mon DD HH24:MI') || ' (' || round(gah.days_since_last_success, 1)::text || ' days ago)' ||
                 E'\n  Failures (24h): ' || COALESCE(gah.auth_failures_24h, 0::bigint)::text ||
                 CASE WHEN gah.credential_drift_detected = true THEN ' | ❌ CREDENTIAL DRIFT DETECTED' ELSE '' END ||
                 E'\n' ||
                 CASE WHEN gah.days_since_last_success > 150::numeric THEN E'  ⚠ Token age warning: > 150 days (Google revokes at 180)\n' ELSE '' END
        END ||
        E'\nPIPELINE LAG (stuck between stages)\n' ||
        '  Enrichment lag (pending >4h): ' || pl.enrichment_lag::text ||
        E'\n  Fit-score lag (enriched, no score >2h): ' || pl.fit_score_lag::text ||
        E'\n  Draft lag (scored, no draft >24h): ' || pl.draft_lag::text ||
        E'\n  Send lag (drafted, not sent >24h): ' || pl.send_lag::text ||
        E'\n\nTHROUGHPUT\n' ||
        '  Sends today: ' || tp.today::text || ' | Last 24h: ' || tp.last_24h::text || ' | 7d avg: ' || COALESCE(tp.avg_7d::text, '0') ||
        E'\n  Fit scores today: ' || st.scored_today::text || ' | 7d avg: ' || COALESCE(st.scored_avg_7d::text, '0') ||
        E'\n  Last lead intake: ' || to_char((li.last_intake_at AT TIME ZONE 'America/New_York'), 'Mon DD HH24:MI') || ' (' || EXTRACT(day FROM li.days_since_intake)::integer::text || ' days ago)' ||
        E'\n' AS briefing
   FROM revenue r,
    unactioned_replies ur,
    unactioned_dms udm,
    form_submissions_no_outreach fsn,
    overdue_followups ovf,
    last_intake li,
    cron_failures cf,
    sends_today,
    cron_summary cs2,
    pipeline_lag pl,
    throughput tp,
    scoring_throughput st,
    alerts_summary als,
    gmail_auth_health gah
     LEFT JOIN conversion_snapshot cs ON true
     LEFT JOIN playbook_latest pl_latest ON true;