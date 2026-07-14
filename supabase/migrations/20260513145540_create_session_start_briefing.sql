CREATE OR REPLACE VIEW session_start_briefing AS
WITH revenue AS (
  SELECT * FROM v_may2026_revenue
),
unactioned_replies AS (
  SELECT COUNT(*) AS n
  FROM warm_outbound_staging
  WHERE (replied_at IS NOT NULL OR dm_replied_at IS NOT NULL)
    AND automation_paused = false
),
inbound_no_outreach AS (
  SELECT COUNT(*) AS n
  FROM form_submissions
  WHERE outreach_email_sent_at IS NULL
    AND created_at > now() - interval '14 days'
    AND email NOT IN ('jon@complianceworxs.com','jon.nugent@digital-360.co','jon.nugent@digiital-360.co','complianceworxs@gmai.com')
    AND email NOT LIKE 'jon@%'
),
cron_failures AS (
  SELECT COUNT(*) AS n FROM cron_health WHERE health != 'healthy'
),
phantombuster_intake AS (
  SELECT MAX(created_at) AS last_pb_lead
  FROM warm_outbound_staging
  WHERE source LIKE 'phantombuster%'
),
overdue_followups AS (
  SELECT COUNT(*) AS n
  FROM warm_outbound_staging
  WHERE next_followup_due_at < now() - interval '24 hours'
    AND followup_completed_at IS NULL
    AND automation_paused = false
    AND replied_at IS NULL
)
SELECT
  E'=== CW SESSION START BRIEFING ===\n' ||
  E'May revenue: $' || COALESCE(r.may_revenue_usd::text, '0') || ' of $' || r.may_target_usd::text ||
  ' (' || COALESCE(r.pct_to_target::text, '0') || '% to target, ' || r.days_remaining_to_may31 || ' days remaining, $' || ROUND(r.required_daily_run_rate_usd::numeric, 2) || '/day required)' ||
  E'\nLast 7d revenue: $' || COALESCE(r.last_7d_revenue_usd::text, '0') ||
  E'\n\n=== ROT FLAGS ===\n' ||
  CASE WHEN ur.n > 0 THEN '⚠️  ' || ur.n || ' replied prospect(s) still unpaused — automation may still hit them' || E'\n' ELSE '' END ||
  CASE WHEN ino.n > 0 THEN '⚠️  ' || ino.n || ' real website form submission(s) with no outreach sent' || E'\n' ELSE '' END ||
  CASE WHEN cf.n > 0 THEN '⚠️  ' || cf.n || ' cron job(s) unhealthy' || E'\n' ELSE '' END ||
  CASE WHEN pb.last_pb_lead < now() - interval '3 days' THEN '⚠️  Phantombuster intake stalled — last lead: ' || COALESCE(pb.last_pb_lead::text, 'never') || E'\n' ELSE '' END ||
  CASE WHEN of.n > 0 THEN '⚠️  ' || of.n || ' followup(s) overdue 24h+' || E'\n' ELSE '' END ||
  CASE WHEN ur.n = 0 AND ino.n = 0 AND cf.n = 0 AND (pb.last_pb_lead >= now() - interval '3 days') AND of.n = 0 THEN '✅  No rot flags. Pipeline clean.' || E'\n' ELSE '' END
  AS briefing
FROM revenue r, unactioned_replies ur, inbound_no_outreach ino, cron_failures cf, phantombuster_intake pb, overdue_followups of;