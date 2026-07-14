-- Backfill: every dispatched lead with a matching followup_1 or followup_2 send
-- in gmail_send_log should have followup_completed_at set to that send time
UPDATE warm_outbound_staging s
SET followup_completed_at = g.last_followup_at
FROM (
  SELECT staging_id, MAX(created_at) as last_followup_at
  FROM gmail_send_log
  WHERE send_kind IN ('followup_1', 'followup_2')
  GROUP BY staging_id
) g
WHERE s.id = g.staging_id
  AND s.followup_completed_at IS NULL;