-- The session_start_briefing view's draft_lag CTE was missing dispatched_at IS NULL,
-- causing it to count leads that had already been sent (the audit detected this
-- as briefing over-reporting by ~25). Same fix for send_lag — should already exclude
-- dispatched but make it explicit for archived_at too.
CREATE OR REPLACE VIEW public.session_start_briefing AS
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
          WHERE ((warm_outbound_staging.replied_at IS NOT NULL) AND (warm_outbound_staging.automation_paused = true) AND (warm_outbound_staging.automation_paused_reason ~~* '%awaiting_human%'::text))
        ), unactioned_dms AS (
         SELECT count(*) AS count,
            min(warm_outbound_staging.dm_replied_at) AS oldest_dm_reply
           FROM warm_outbound_staging
          WHERE ((warm_outbound_staging.dm_replied_at IS NOT NULL) AND (warm_outbound_staging.automation_paused = false) AND (warm_outbound_staging.followup_completed_at IS NULL))
        ), form_submissions_no_outreach AS (
         SELECT count(*) AS count
           FROM form_submissions f
          WHERE ((f.created_at > (now() - '14 days'::interval)) AND (f.email !~~* '%complianceworxs%'::text) AND (f.email !~~* '%digital-360%'::text) AND (f.email !~~* '%digiital-360%'::text) AND (f.email !~~* '%gmai.com%'::text) AND (f.outreach_email_sent_at IS NULL) AND ((f.is_blocked IS NULL) OR (f.is_blocked = false)) AND (NOT (EXISTS ( SELECT 1
                   FROM gmail_send_log g
                  WHERE (g.recipient_email = f.email)))))
        ), overdue_followups AS (
         SELECT count(*) AS count
           FROM warm_outbound_staging
          WHERE ((warm_outbound_staging.next_followup_due_at < (now() - '24:00:00'::interval)) AND (warm_outbound_staging.followup_completed_at IS NULL) AND (warm_outbound_staging.replied_at IS NULL) AND (warm_outbound_staging.automation_paused = false))
        ), last_intake AS (
         SELECT max(warm_outbound_staging.created_at) AS last_intake_at,
            (now() - max(warm_outbound_staging.created_at)) AS days_since_intake
           FROM warm_outbound_staging
        ), sends_today AS (
         SELECT count(*) AS count
           FROM gmail_send_log
          WHERE ((gmail_send_log.created_at)::date = ((now() AT TIME ZONE 'America/New_York'::text))::date)
        ), cron_health AS (
         WITH critical_jobs AS (
                 SELECT job.jobid,
                    job.jobname,
                    job.schedule,
                        CASE
                            WHEN (job.schedule = '*/5 * * * *'::text) THEN 15
                            WHEN ((job.schedule ~~ '%/15 * * * *'::text) OR (job.schedule = '5,20,35,50 * * * *'::text)) THEN 45
                            WHEN ((job.schedule ~~ '0 % * * *'::text) OR (job.schedule ~~ '45 % * * *'::text) OR (job.schedule ~~ '30 % * * *'::text)) THEN 1500
                            ELSE 180
                        END AS stale_threshold_min
                   FROM cron.job
                  WHERE ((job.active = true) AND (job.jobname !~~* '%stripe%'::text) AND (job.jobname !~~* '%partner%'::text))
                ), last_runs AS (
                 SELECT job_run_details.jobid,
                    max(job_run_details.end_time) FILTER (WHERE (job_run_details.status = 'succeeded'::text)) AS last_success,
                    count(*) FILTER (WHERE ((job_run_details.status = 'failed'::text) AND (job_run_details.start_time > (now() - '24:00:00'::interval)))) AS failures_24h
                   FROM cron.job_run_details
                  WHERE (job_run_details.start_time > (now() - '7 days'::interval))
                  GROUP BY job_run_details.jobid
                )
         SELECT cj.jobname,
                CASE
                    WHEN (lr.last_success IS NULL) THEN 'NO_RUN_HISTORY'::text
                    WHEN ((EXTRACT(epoch FROM (now() - lr.last_success)) / (60)::numeric) > (cj.stale_threshold_min)::numeric) THEN 'STALE'::text
                    WHEN (lr.failures_24h > 0) THEN 'FAILING'::text
                    ELSE 'HEALTHY'::text
                END AS health
           FROM (critical_jobs cj
             LEFT JOIN last_runs lr ON ((lr.jobid = cj.jobid)))
        ), cron_summary AS (
         SELECT count(*) FILTER (WHERE (cron_health.health = 'HEALTHY'::text)) AS healthy,
            count(*) FILTER (WHERE (cron_health.health = 'NO_RUN_HISTORY'::text)) AS no_history,
            count(*) FILTER (WHERE (cron_health.health = 'STALE'::text)) AS stale,
            count(*) FILTER (WHERE (cron_health.health = 'FAILING'::text)) AS failing,
            count(*) AS total,
            string_agg(cron_health.jobname, ', '::text) FILTER (WHERE (cron_health.health <> 'HEALTHY'::text)) AS unhealthy_jobs
           FROM cron_health
        ), pipeline_lag AS (
         SELECT ( SELECT count(*) AS count
                   FROM warm_outbound_staging
                  WHERE ((warm_outbound_staging.enrichment_status = 'enriched'::text) AND (warm_outbound_staging.email IS NOT NULL) AND (warm_outbound_staging.fit_score IS NULL) AND (warm_outbound_staging.enriched_at < (now() - '02:00:00'::interval)))) AS fit_score_lag,
            ( SELECT count(*) AS count
                   FROM warm_outbound_staging
                  WHERE ((warm_outbound_staging.enrichment_status = 'pending'::text) AND (warm_outbound_staging.created_at < (now() - '04:00:00'::interval)))) AS enrichment_lag,
            ( SELECT count(*) AS count
                   FROM warm_outbound_staging
                  WHERE ((warm_outbound_staging.fit_score >= 80) AND (warm_outbound_staging.first_touch_draft_body IS NULL) AND (warm_outbound_staging.fit_scored_at IS NOT NULL) AND (warm_outbound_staging.fit_scored_at < (now() - '24:00:00'::interval)) AND (warm_outbound_staging.automation_paused = false) AND (warm_outbound_staging.is_paying_customer IS NOT TRUE) AND (warm_outbound_staging.replied_at IS NULL) AND (warm_outbound_staging.dispatched_at IS NULL) AND (warm_outbound_staging.archived_at IS NULL))) AS draft_lag,
            ( SELECT count(*) AS count
                   FROM warm_outbound_staging
                  WHERE ((warm_outbound_staging.first_touch_draft_body IS NOT NULL) AND (warm_outbound_staging.dispatched_at IS NULL) AND (warm_outbound_staging.first_touch_drafted_at < (now() - '24:00:00'::interval)) AND (warm_outbound_staging.automation_paused = false) AND (warm_outbound_staging.is_paying_customer IS NOT TRUE) AND (warm_outbound_staging.replied_at IS NULL) AND (warm_outbound_staging.archived_at IS NULL))) AS send_lag
        ), throughput AS (
         SELECT ( SELECT count(*) AS count
                   FROM gmail_send_log
                  WHERE ((gmail_send_log.created_at)::date = ((now() AT TIME ZONE 'America/New_York'::text))::date)) AS today,
            ( SELECT round(((count(*))::numeric / (7)::numeric), 1) AS round
                   FROM gmail_send_log
                  WHERE (gmail_send_log.created_at > (now() - '7 days'::interval))) AS avg_7d,
            ( SELECT count(*) AS count
                   FROM gmail_send_log
                  WHERE (gmail_send_log.created_at > (now() - '24:00:00'::interval))) AS last_24h
        ), scoring_throughput AS (
         SELECT ( SELECT count(*) AS count
                   FROM warm_outbound_staging
                  WHERE ((warm_outbound_staging.fit_scored_at)::date = ((now() AT TIME ZONE 'America/New_York'::text))::date)) AS scored_today,
            ( SELECT round(((count(*))::numeric / (7)::numeric), 1) AS round
                   FROM warm_outbound_staging
                  WHERE (warm_outbound_staging.fit_scored_at > (now() - '7 days'::interval))) AS scored_avg_7d
        ), cron_failures AS (
         SELECT count(*) AS count
           FROM cron.job_run_details
          WHERE ((job_run_details.start_time > (now() - '24:00:00'::interval)) AND (job_run_details.status = 'failed'::text))
        ), alerts_summary AS (
         SELECT count(*) FILTER (WHERE ((system_alerts.severity = 'critical'::text) AND (system_alerts.resolved_at IS NULL))) AS critical_unresolved,
            count(*) FILTER (WHERE ((system_alerts.severity = 'warning'::text) AND (system_alerts.resolved_at IS NULL))) AS warning_unresolved,
            count(*) FILTER (WHERE (system_alerts.created_at > (now() - '24:00:00'::interval))) AS alerts_24h,
            string_agg(DISTINCT system_alerts.alert_type, ', '::text) FILTER (WHERE ((system_alerts.resolved_at IS NULL) AND (system_alerts.severity = ANY (ARRAY['critical'::text, 'warning'::text])))) AS unresolved_types
           FROM system_alerts
        ), gmail_auth_health AS (
         SELECT max(gmail_auth_state.checked_at) FILTER (WHERE (gmail_auth_state.refresh_succeeded = true)) AS last_successful_auth,
            count(*) FILTER (WHERE ((gmail_auth_state.checked_at > (now() - '24:00:00'::interval)) AND (gmail_auth_state.refresh_succeeded = false))) AS auth_failures_24h,
            bool_or((gmail_auth_state.audience_matches_env = false)) FILTER (WHERE (gmail_auth_state.checked_at > (now() - '24:00:00'::interval))) AS credential_drift_detected,
            (EXTRACT(epoch FROM (now() - max(gmail_auth_state.checked_at) FILTER (WHERE (gmail_auth_state.refresh_succeeded = true)))) / (86400)::numeric) AS days_since_last_success
           FROM gmail_auth_state
        )
 SELECT (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((('=== CW SESSION BRIEFING '::text || to_char((now() AT TIME ZONE 'America/New_York'::text), 'YYYY-MM-DD HH24:MI EDT'::text)) || ' ==='::text) || E'\n\n'::text) || 'REVENUE'::text) || E'\n'::text) || '  May MTD: $'::text) || COALESCE((round(r.may_revenue_usd, 2))::text, '0.00'::text)) || ' of $'::text) || (round(r.may_target_usd))::text) || ' ('::text) || (round(r.pct_to_target, 1))::text) || '%)'::text) || E'\n'::text) || '  Days remaining: '::text) || (r.days_remaining_to_may31)::text) || ' | Required daily run rate: $'::text) || (round(r.required_daily_run_rate_usd, 2))::text) || E'\n\n'::text) ||
        CASE
            WHEN ((als.critical_unresolved > 0) OR (als.warning_unresolved > 0)) THEN ((((('🚨 UNRESOLVED ALERTS'::text || E'\n'::text) ||
            CASE
                WHEN (als.critical_unresolved > 0) THEN (('  ❌ CRITICAL: '::text || (als.critical_unresolved)::text) || E'\n'::text)
                ELSE ''::text
            END) ||
            CASE
                WHEN (als.warning_unresolved > 0) THEN (('  ⚠ Warning: '::text || (als.warning_unresolved)::text) || E'\n'::text)
                ELSE ''::text
            END) ||
            CASE
                WHEN (als.unresolved_types IS NOT NULL) THEN (('  Types: '::text || als.unresolved_types) || E'\n'::text)
                ELSE ''::text
            END) || E'\n'::text)
            ELSE ''::text
        END) || 'ROT FLAGS (data)'::text) || E'\n'::text) || '  Unactioned replies (email): '::text) || (ur.count)::text) ||
        CASE
            WHEN (ur.oldest_reply IS NOT NULL) THEN ((' (oldest: '::text || to_char((ur.oldest_reply AT TIME ZONE 'America/New_York'::text), 'Mon DD'::text)) || ')'::text)
            ELSE ''::text
        END) || E'\n'::text) || '  Unactioned DM replies: '::text) || (udm.count)::text) ||
        CASE
            WHEN (udm.oldest_dm_reply IS NOT NULL) THEN ((' (oldest: '::text || to_char((udm.oldest_dm_reply AT TIME ZONE 'America/New_York'::text), 'Mon DD'::text)) || ')'::text)
            ELSE ''::text
        END) || E'\n'::text) || '  Form submissions with no outreach: '::text) || (fsn.count)::text) || E'\n'::text) || '  Overdue followups (>24h, not paused, no reply): '::text) || (of.count)::text) || E'\n'::text) || '  Edge function failures (24h): '::text) || (cf.count)::text) || E'\n\n'::text) || 'AUTOMATION HEALTH (crons)'::text) || E'\n'::text) || '  Healthy: '::text) || (cs.healthy)::text) || ' / '::text) || (cs.total)::text) ||
        CASE
            WHEN (cs.no_history > 0) THEN (' | NO_RUN_HISTORY: '::text || (cs.no_history)::text)
            ELSE ''::text
        END) ||
        CASE
            WHEN (cs.stale > 0) THEN (' | STALE: '::text || (cs.stale)::text)
            ELSE ''::text
        END) ||
        CASE
            WHEN (cs.failing > 0) THEN (' | FAILING: '::text || (cs.failing)::text)
            ELSE ''::text
        END) || E'\n'::text) ||
        CASE
            WHEN (cs.unhealthy_jobs IS NOT NULL) THEN (('  ⚠ Unhealthy: '::text || cs.unhealthy_jobs) || E'\n'::text)
            ELSE ''::text
        END) || E'\n'::text) || 'GMAIL AUTH'::text) || E'\n'::text) ||
        CASE
            WHEN (gah.last_successful_auth IS NULL) THEN ('  ⚠ No auth attempts logged yet (table newly created — first batch will populate)'::text || E'\n'::text)
            ELSE (((((((((('  Last successful refresh: '::text || to_char((gah.last_successful_auth AT TIME ZONE 'America/New_York'::text), 'Mon DD HH24:MI'::text)) || ' ('::text) || (round(gah.days_since_last_success, 1))::text) || ' days ago)'::text) || E'\n'::text) || '  Failures (24h): '::text) || (COALESCE(gah.auth_failures_24h, (0)::bigint))::text) ||
            CASE
                WHEN (gah.credential_drift_detected = true) THEN ' | ❌ CREDENTIAL DRIFT DETECTED'::text
                ELSE ''::text
            END) || E'\n'::text) ||
            CASE
                WHEN (gah.days_since_last_success > (150)::numeric) THEN ('  ⚠ Token age warning: > 150 days (Google revokes at 180)'::text || E'\n'::text)
                ELSE ''::text
            END)
        END) || E'\n'::text) || 'PIPELINE LAG (stuck between stages)'::text) || E'\n'::text) || '  Enrichment lag (pending >4h): '::text) || (pl.enrichment_lag)::text) || E'\n'::text) || '  Fit-score lag (enriched, no score >2h): '::text) || (pl.fit_score_lag)::text) || E'\n'::text) || '  Draft lag (scored, no draft >24h): '::text) || (pl.draft_lag)::text) || E'\n'::text) || '  Send lag (drafted, not sent >24h): '::text) || (pl.send_lag)::text) || E'\n\n'::text) || 'THROUGHPUT'::text) || E'\n'::text) || '  Sends today: '::text) || (tp.today)::text) || ' | Last 24h: '::text) || (tp.last_24h)::text) || ' | 7d avg: '::text) || COALESCE((tp.avg_7d)::text, '0'::text)) || E'\n'::text) || '  Fit scores today: '::text) || (st.scored_today)::text) || ' | 7d avg: '::text) || COALESCE((st.scored_avg_7d)::text, '0'::text)) || E'\n'::text) || '  Last lead intake: '::text) || to_char((li.last_intake_at AT TIME ZONE 'America/New_York'::text), 'Mon DD HH24:MI'::text)) || ' ('::text) || ((EXTRACT(day FROM li.days_since_intake))::integer)::text) || ' days ago)'::text) || E'\n'::text) AS briefing
   FROM revenue r,
    unactioned_replies ur,
    unactioned_dms udm,
    form_submissions_no_outreach fsn,
    overdue_followups of,
    last_intake li,
    cron_failures cf,
    sends_today,
    cron_summary cs,
    pipeline_lag pl,
    throughput tp,
    scoring_throughput st,
    alerts_summary als,
    gmail_auth_health gah;