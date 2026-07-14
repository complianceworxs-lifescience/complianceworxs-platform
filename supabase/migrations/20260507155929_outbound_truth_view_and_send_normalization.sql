-- 1. Authoritative view: which leads were ACTUALLY emailed (Gmail-confirmed)
CREATE OR REPLACE VIEW leads_actually_emailed AS
SELECT 
  ws.id AS staging_id,
  ws.email,
  ws.full_name,
  ws.company,
  ws.industry,
  ws.fit_score,
  ws.buyer_pipeline_stage,
  ws.first_touch_draft_subject,
  ws.replied_at,
  ws.followup_stage,
  ws.next_followup_due_at,
  g.send_date AS actual_send_date,
  g.gmail_thread_id,
  g.send_kind
FROM warm_outbound_staging ws
JOIN gmail_send_log g ON LOWER(g.recipient_email) = LOWER(ws.email)
WHERE ws.archived_at IS NULL;

COMMENT ON VIEW leads_actually_emailed IS 'Authoritative source of truth for who was actually emailed via Gmail. Joins staging to gmail_send_log. Use this instead of warm_outbound_staging.last_sequence_email_at which is unreliable.';

-- 2. The phantom-sent view: rows that staging thinks were sent but Gmail has no record of
CREATE OR REPLACE VIEW phantom_sends AS
SELECT 
  ws.id,
  ws.email,
  ws.full_name,
  ws.company,
  ws.industry,
  ws.fit_score,
  ws.buyer_pipeline_stage,
  ws.first_touch_draft_subject,
  ws.first_touch_draft_body IS NOT NULL AS has_body,
  ws.email_approved,
  ws.send_provider,
  ws.send_message_id,
  ws.delivery_status,
  ws.dispatched_at,
  ws.last_sequence_email_at,
  ws.send_attempts,
  ws.archived_at IS NULL AS not_archived
FROM warm_outbound_staging ws
WHERE ws.archived_at IS NULL
  AND ws.first_touch_draft_body IS NOT NULL
  AND ws.email_approved = true
  AND ws.is_paying_customer = false
  AND ws.dispatched_at IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM gmail_send_log g WHERE LOWER(g.recipient_email) = LOWER(ws.email));

COMMENT ON VIEW phantom_sends IS 'Leads marked as dispatched in staging but with no actual Gmail send record. These need to be re-queued or investigated.';