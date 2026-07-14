-- Fix: briefing's "Form submissions with no outreach" doesn't exclude blocked spam
-- Spam submissions with is_blocked = TRUE were flagging as rot
-- Fix: add is_blocked exclusion to the form_submissions_no_outreach CTE

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
  WHERE warm_outbound_staging.replied_at IS NOT NULL 
    AND warm_outbound_staging.automation_paused = true 
    AND warm_outbound_staging.automation_paused_reason ILIKE '%awaiting_human%'
), unactioned_dms AS (
  SELECT count(*) AS count,
    min(warm_outbound_staging.dm_replied_at) AS oldest_dm_reply
  FROM warm_outbound_staging
  WHERE warm_outbound_staging.dm_replied_at IS NOT NULL 
    AND warm_outbound_staging.automation_paused = false
    AND warm_outbound_staging.followup_completed_at IS NULL
), form_submissions_no_outreach AS (
  SELECT count(*) AS count
  FROM form_submissions f
  WHERE f.created_at > (now() - '14 days'::interval) 
    AND f.email NOT ILIKE '%complianceworxs%' 
    AND f.email NOT ILIKE '%digital-360%' 
    AND f.email NOT ILIKE '%digiital-360%' 
    AND f.email NOT ILIKE '%gmai.com%' 
    AND f.outreach_email_sent_at IS NULL 
    AND (f.is_blocked IS NULL OR f.is_blocked = FALSE)  -- FIX: exclude spam-blocked submissions
    AND NOT EXISTS (
      SELECT 1 FROM gmail_send_log g WHERE g.recipient_email = f.email
    )
), overdue_followups AS (
  SELECT count(*) AS count
  FROM warm_outbound_staging
  WHERE warm_outbound_staging.next_followup_due_at < (now() - '24:00:00'::interval) 
    AND warm_outbound_staging.followup_completed_at IS NULL 
    AND warm_outbound_staging.replied_at IS NULL 
    AND warm_outbound_staging.automation_paused = false
), last_intake AS (
  SELECT max(warm_outbound_staging.created_at) AS last_intake_at,
    (now() - max(warm_outbound_staging.created_at)) AS days_since_intake
  FROM warm_outbound_staging
), cron_failures AS (
  SELECT count(*) AS count
  FROM cron.job_run_details
  WHERE job_run_details.start_time > (now() - '24:00:00'::interval) 
    AND job_run_details.status = 'failed'::text
), sends_today AS (
  SELECT count(*) AS count
  FROM gmail_send_log
  WHERE (gmail_send_log.created_at)::date = ((now() AT TIME ZONE 'America/New_York'::text))::date
)
SELECT (
  '=== CW SESSION BRIEFING '::text || to_char((now() AT TIME ZONE 'America/New_York'::text), 'YYYY-MM-DD HH24:MI EDT'::text) || ' ===' ||
  E'\n\n' ||
  'REVENUE' || E'\n' ||
  '  May MTD: $' || COALESCE(round(r.may_revenue_usd, 2)::text, '0.00') || ' of $' || round(r.may_target_usd)::text || ' (' || round(r.pct_to_target, 1)::text || '%)' || E'\n' ||
  '  Days remaining: ' || r.days_remaining_to_may31::text || ' | Required daily run rate: $' || round(r.required_daily_run_rate_usd, 2)::text || E'\n\n' ||
  'ROT FLAGS' || E'\n' ||
  '  Unactioned replies (email): ' || ur.count::text ||
    CASE WHEN ur.oldest_reply IS NOT NULL THEN ' (oldest: ' || to_char((ur.oldest_reply AT TIME ZONE 'America/New_York'::text), 'Mon DD') || ')' ELSE '' END || E'\n' ||
  '  Unactioned DM replies: ' || udm.count::text ||
    CASE WHEN udm.oldest_dm_reply IS NOT NULL THEN ' (oldest: ' || to_char((udm.oldest_dm_reply AT TIME ZONE 'America/New_York'::text), 'Mon DD') || ')' ELSE '' END || E'\n' ||
  '  Form submissions with no outreach: ' || fsn.count::text || E'\n' ||
  '  Overdue followups (>24h, not paused, no reply): ' || of.count::text || E'\n' ||
  '  Cron failures (24h): ' || cf.count::text || E'\n\n' ||
  'PIPELINE FLOW' || E'\n' ||
  '  Sends today: ' || st.count::text || E'\n' ||
  '  Last lead intake: ' || to_char((li.last_intake_at AT TIME ZONE 'America/New_York'::text), 'Mon DD HH24:MI') || ' (' || EXTRACT(day FROM li.days_since_intake)::integer::text || ' days ago)' || E'\n'
) AS briefing
FROM revenue r, unactioned_replies ur, unactioned_dms udm, form_submissions_no_outreach fsn, overdue_followups of, last_intake li, cron_failures cf, sends_today st;