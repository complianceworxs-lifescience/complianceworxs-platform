CREATE OR REPLACE VIEW public.session_start_briefing AS
WITH revenue AS (
  SELECT * FROM v_may2026_revenue
),
unactioned_replies AS (
  SELECT COUNT(*) as count, MIN(replied_at) as oldest_reply
  FROM warm_outbound_staging
  WHERE replied_at IS NOT NULL
    AND automation_paused = true
    AND automation_paused_reason ILIKE '%awaiting_human%'
),
unactioned_dms AS (
  SELECT COUNT(*) as count, MIN(dm_replied_at) as oldest_dm_reply
  FROM warm_outbound_staging
  WHERE dm_replied_at IS NOT NULL
    AND automation_paused = false
),
form_submissions_no_outreach AS (
  SELECT COUNT(*) as count
  FROM form_submissions f
  WHERE f.created_at > now() - interval '14 days'
    AND f.email NOT ILIKE '%complianceworxs%'
    AND f.email NOT ILIKE '%digital-360%'
    AND f.email NOT ILIKE '%digiital-360%'
    AND f.email NOT ILIKE '%gmai.com%'
    AND f.outreach_email_sent_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM gmail_send_log g
      WHERE g.recipient_email = f.email
    )
),
overdue_followups AS (
  SELECT COUNT(*) as count
  FROM warm_outbound_staging
  WHERE next_followup_due_at < now() - interval '24 hours'
    AND followup_completed_at IS NULL
    AND replied_at IS NULL
    AND automation_paused = false
),
last_intake AS (
  SELECT MAX(created_at) as last_intake_at,
         now() - MAX(created_at) as days_since_intake
  FROM warm_outbound_staging
),
cron_failures AS (
  SELECT COUNT(*) as count
  FROM cron.job_run_details
  WHERE start_time > now() - interval '24 hours'
    AND status = 'failed'
),
sends_today AS (
  SELECT COUNT(*) as count
  FROM gmail_send_log
  WHERE created_at::date = (now() AT TIME ZONE 'America/New_York')::date
)
SELECT
  E'=== CW SESSION BRIEFING ' || to_char(now() AT TIME ZONE 'America/New_York', 'YYYY-MM-DD HH24:MI EDT') || E' ===\n' ||
  E'\n' ||
  E'REVENUE\n' ||
  E'  May MTD: $' || COALESCE(round(r.may_revenue_usd::numeric, 2)::text, '0.00') ||
    ' of $' || round(r.may_target_usd::numeric)::text ||
    ' (' || round(r.pct_to_target::numeric, 1)::text || '%)\n' ||
  E'  Days remaining: ' || r.days_remaining_to_may31::text ||
    ' | Required daily run rate: $' || round(r.required_daily_run_rate_usd::numeric, 2)::text || E'\n' ||
  E'\n' ||
  E'ROT FLAGS\n' ||
  E'  Unactioned replies (email): ' || ur.count::text ||
    CASE WHEN ur.oldest_reply IS NOT NULL
      THEN ' (oldest: ' || to_char(ur.oldest_reply AT TIME ZONE 'America/New_York', 'Mon DD') || ')'
      ELSE '' END || E'\n' ||
  E'  Unactioned DM replies: ' || udm.count::text ||
    CASE WHEN udm.oldest_dm_reply IS NOT NULL
      THEN ' (oldest: ' || to_char(udm.oldest_dm_reply AT TIME ZONE 'America/New_York', 'Mon DD') || ')'
      ELSE '' END || E'\n' ||
  E'  Form submissions with no outreach: ' || fsn.count::text || E'\n' ||
  E'  Overdue followups (>24h, not paused, no reply): ' || of.count::text || E'\n' ||
  E'  Cron failures (24h): ' || cf.count::text || E'\n' ||
  E'\n' ||
  E'PIPELINE FLOW\n' ||
  E'  Sends today: ' || st.count::text || E'\n' ||
  E'  Last lead intake: ' || to_char(li.last_intake_at AT TIME ZONE 'America/New_York', 'Mon DD HH24:MI') ||
    ' (' || EXTRACT(DAY FROM li.days_since_intake)::int::text || ' days ago)\n'
  AS briefing
FROM revenue r, unactioned_replies ur, unactioned_dms udm,
     form_submissions_no_outreach fsn, overdue_followups of,
     last_intake li, cron_failures cf, sends_today st;