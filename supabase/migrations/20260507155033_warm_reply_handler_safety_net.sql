-- Safety net: any positive reply that sits more than 6 hours without follow-up gets flagged.
-- This view powers a daily check that surfaces stuck warm leads.
CREATE OR REPLACE VIEW stuck_positive_replies AS
WITH positive_classifications AS (
  SELECT DISTINCT ON (LOWER(email)) 
    LOWER(email) AS email,
    attio_record_id,
    created_at AS classified_at,
    properties
  FROM outbound_events
  WHERE event_name = 'reply_classified'
    AND properties->>'classification' = 'positive'
    AND email NOT LIKE '%@example.com'
    AND email NOT LIKE '%test%@%'
  ORDER BY LOWER(email), created_at DESC
),
sends_after AS (
  SELECT 
    LOWER(oe.email) AS email,
    COUNT(*) AS sends_count
  FROM outbound_events oe
  JOIN positive_classifications pc ON LOWER(oe.email) = pc.email
  WHERE oe.event_name = 'outbound_email_sent'
    AND oe.created_at > pc.classified_at
  GROUP BY LOWER(oe.email)
)
SELECT 
  pc.email,
  pc.attio_record_id,
  pc.classified_at,
  EXTRACT(EPOCH FROM (now() - pc.classified_at))/3600 AS hours_since_reply,
  COALESCE(sa.sends_count, 0) AS sends_after_reply,
  ws.full_name,
  ws.first_name,
  ws.company,
  ws.job_title,
  ws.industry,
  ws.fit_score,
  ws.buyer_pipeline_stage,
  ws.first_touch_draft_subject,
  ws.linkedin_url,
  CASE 
    WHEN COALESCE(sa.sends_count, 0) = 0 AND now() - pc.classified_at > interval '6 hours' THEN 'STUCK'
    WHEN COALESCE(sa.sends_count, 0) = 0 AND now() - pc.classified_at > interval '1 hour' THEN 'WARNING'
    ELSE 'OK'
  END AS status
FROM positive_classifications pc
LEFT JOIN sends_after sa ON sa.email = pc.email
LEFT JOIN warm_outbound_staging ws ON LOWER(ws.email) = pc.email
WHERE pc.classified_at >= now() - interval '30 days'
ORDER BY pc.classified_at DESC;

COMMENT ON VIEW stuck_positive_replies IS 'Surfaces positive-classified replies that have not received a follow-up. Anything in STUCK status is leaking revenue.';