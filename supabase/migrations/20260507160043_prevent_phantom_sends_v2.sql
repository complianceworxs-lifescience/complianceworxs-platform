ALTER TABLE warm_outbound_staging
  ADD CONSTRAINT valid_send_provider_no_deprecated 
  CHECK (send_provider IS NULL OR send_provider IN ('gmail', 'invalid_format', 'suppressed'));

COMMENT ON CONSTRAINT valid_send_provider_no_deprecated ON warm_outbound_staging 
  IS 'Resend is deprecated. Only gmail (real sends), invalid_format, and suppressed are allowed values.';

CREATE OR REPLACE VIEW conversion_focus_today AS
SELECT 
  ws.id,
  ws.email,
  ws.full_name,
  ws.company,
  ws.industry,
  ws.fit_score,
  ws.role_seniority,
  ws.buyer_pipeline_stage,
  ws.first_touch_draft_subject,
  g.send_date AS sent_date,
  g.gmail_thread_id,
  EXTRACT(EPOCH FROM (now() - g.send_date::timestamp))/86400 AS days_since_send,
  ws.linkedin_url,
  ws.attio_record_id,
  ws.next_followup_due_at::date AS followup_due,
  ws.followup_stage,
  CASE 
    WHEN ws.replied_at IS NOT NULL THEN 'replied'
    WHEN ws.next_followup_due_at <= now() THEN 'followup_due'
    WHEN g.send_date >= CURRENT_DATE - INTERVAL '3 days' THEN 'recent_send'
    ELSE 'awaiting_followup'
  END AS focus_status
FROM warm_outbound_staging ws
JOIN gmail_send_log g ON LOWER(g.recipient_email) = LOWER(ws.email)
WHERE ws.is_paying_customer = false
  AND ws.archived_at IS NULL
  AND ws.fit_score >= 80
ORDER BY ws.fit_score DESC, g.send_date DESC;