-- Replace phantoms CTE: exclude suppressed (legitimate non-send) and NULL provider with no message_id (already cleaned)
CREATE OR REPLACE VIEW session_start_briefing AS
WITH 
outbound AS (
  SELECT
    (SELECT count(*) FROM gmail_send_log WHERE created_at::date = CURRENT_DATE AND http_status BETWEEN 200 AND 299) AS sends_today,
    (SELECT count(*) FROM warm_outbound_staging WHERE email_approved=true AND automation_paused=false AND dispatched_at IS NULL AND archived_at IS NULL) AS ready_first_touch,
    (SELECT count(*) FROM warm_outbound_staging WHERE next_followup_due_at IS NOT NULL AND next_followup_due_at <= NOW() AND automation_paused=false AND archived_at IS NULL AND replied_at IS NULL) AS followups_due,
    (SELECT count(*) FROM warm_outbound_staging WHERE automation_paused=true AND replied_at IS NULL AND archived_at IS NULL) AS paused_needs_review,
    (SELECT count(*) FROM warm_outbound_staging WHERE replied_at IS NOT NULL AND replied_at > NOW() - INTERVAL '7 days') AS recent_replies_7d
),
revenue AS (
  SELECT
    (SELECT COALESCE(sum(amount_cents),0)/100.0 FROM orders WHERE created_at >= date_trunc('month', NOW()) AND order_status NOT IN ('refunded','failed','cancelled')) AS month_revenue_usd,
    (SELECT count(*) FROM orders WHERE created_at >= date_trunc('month', NOW()) AND order_status NOT IN ('refunded','failed','cancelled')) AS month_orders
),
dm_queue AS (
  SELECT
    (SELECT count(*) FROM linkedin_dm_send_queue WHERE status='draft' AND approved_by_jon=false) AS dms_awaiting_approval,
    (SELECT count(*) FROM linkedin_dm_send_queue WHERE status='queued' AND approved_by_jon=true) AS dms_approved_pending_send
),
attio AS (
  SELECT
    (SELECT count(*) FROM attio_task_chase_log WHERE (resolution IS NULL OR resolution='still_open') AND staleness_hours > 48) AS stale_tasks_48h,
    (SELECT count(*) FROM attio_task_chase_log WHERE (resolution IS NULL OR resolution='still_open') AND staleness_hours > 168) AS critical_tasks_7d
),
crons AS (
  SELECT count(*) AS broken_crons
  FROM cron.job j
  WHERE j.active = true
    AND NOT EXISTS (SELECT 1 FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.start_time > NOW() - INTERVAL '48 hours' AND d.status = 'succeeded')
),
phantoms AS (
  -- Only count REAL phantoms: claims to have been sent via gmail but no gmail log row.
  -- Excludes suppressed sends (legitimate non-sends marked by sender).
  SELECT count(*) AS phantom_count
  FROM warm_outbound_staging ws
  WHERE ws.dispatched_at IS NOT NULL 
    AND ws.dispatched_at > NOW() - INTERVAL '7 days'
    AND ws.send_provider = 'gmail'
    AND NOT EXISTS (SELECT 1 FROM gmail_send_log g WHERE g.staging_id = ws.id AND g.http_status BETWEEN 200 AND 299)
),
stuck_replies AS (
  SELECT count(*) AS stuck_count
  FROM warm_outbound_staging
  WHERE replied_at IS NOT NULL AND replied_at < NOW() - INTERVAL '6 hours'
    AND last_attio_status IN ('Replied','Qualified','High intent') AND archived_at IS NULL
)
SELECT 
  CONCAT(
    E'# CW SESSION START — ', to_char(NOW(),'YYYY-MM-DD HH24:MI UTC'), E'\n\n',
    E'## REVENUE\n',
    E'May target: $1,500. Current: $', revenue.month_revenue_usd, ' (', revenue.month_orders, ' orders).',
    CASE WHEN revenue.month_revenue_usd < 1500 THEN ' GAP: $' || (1500 - revenue.month_revenue_usd) || E'\n\n' ELSE E' MET\n\n' END,
    E'## OUTBOUND TODAY\n',
    E'Real Gmail sends today: ', outbound.sends_today, E'\n',
    E'Ready first-touch queue: ', outbound.ready_first_touch, E'\n',
    E'Follow-ups due: ', outbound.followups_due, E'\n',
    E'Paused needing review: ', outbound.paused_needs_review, E'\n',
    E'Replies last 7 days: ', outbound.recent_replies_7d, E'\n\n',
    E'## DM QUEUE\n',
    E'Drafted, awaiting Jon approval: ', dm_queue.dms_awaiting_approval, E'\n',
    E'Approved, pending phantom send: ', dm_queue.dms_approved_pending_send, E'\n\n',
    E'## ROT FLAGS (act on these BEFORE answering Jon''s question)\n',
    CASE WHEN attio.stale_tasks_48h > 0 THEN '⚠ ' || attio.stale_tasks_48h || E' Attio tasks stale >48h\n' ELSE '' END,
    CASE WHEN attio.critical_tasks_7d > 0 THEN '🚨 ' || attio.critical_tasks_7d || E' Attio tasks CRITICAL >7d\n' ELSE '' END,
    CASE WHEN phantoms.phantom_count > 0 THEN '🚨 ' || phantoms.phantom_count || E' phantom sends detected\n' ELSE '' END,
    CASE WHEN stuck_replies.stuck_count > 0 THEN '🚨 ' || stuck_replies.stuck_count || E' positive replies stuck >6h\n' ELSE '' END,
    CASE WHEN crons.broken_crons > 0 THEN '⚠ ' || crons.broken_crons || E' crons not succeeded in 48h\n' ELSE '' END,
    CASE WHEN attio.stale_tasks_48h = 0 AND phantoms.phantom_count = 0 AND stuck_replies.stuck_count = 0 AND crons.broken_crons = 0 THEN E'✓ No rot flags\n' ELSE '' END,
    E'\n## SESSION RULE\n',
    E'1. If any rot flag above is non-zero, surface and fix BEFORE answering Jon.\n',
    E'2. Read cw-operator-mode, cw-pipeline-operator, cw-solution-mode skills before responding.\n',
    E'3. When a problem is found, the next move is the fix — not the explanation.\n',
    E'4. Never order-take when these skills apply.'
  ) AS briefing,
  outbound.sends_today, outbound.ready_first_touch, outbound.followups_due,
  revenue.month_revenue_usd, attio.stale_tasks_48h, phantoms.phantom_count,
  stuck_replies.stuck_count, crons.broken_crons, dm_queue.dms_awaiting_approval
FROM outbound, revenue, dm_queue, attio, crons, phantoms, stuck_replies;