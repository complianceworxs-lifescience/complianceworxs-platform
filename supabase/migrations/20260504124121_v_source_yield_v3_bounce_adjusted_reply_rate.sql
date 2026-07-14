DROP VIEW IF EXISTS v_source_yield_decisions;
DROP VIEW IF EXISTS v_source_yield;

CREATE VIEW v_source_yield AS
WITH leads AS (
  SELECT
    COALESCE(source, '(none)') AS source,
    cohort_label,
    id AS lead_id,
    email,
    enrichment_status,
    review_status,
    dispatched_at,
    replied_at,
    delivery_status,
    bounce_type,
    created_at::date AS day_added
  FROM warm_outbound_staging
  WHERE archived_at IS NULL
),
revenue_per_lead AS (
  SELECT
    l.lead_id,
    COALESCE(SUM(o.amount_cents), 0) AS revenue_cents,
    COUNT(o.id) AS order_count
  FROM leads l
  LEFT JOIN contacts c ON LOWER(c.email) = LOWER(l.email) AND l.email IS NOT NULL
  LEFT JOIN orders o ON o.contact_id = c.id 
                     AND o.order_status = 'paid'
                     AND o.refunded_at IS NULL
  GROUP BY l.lead_id
)
SELECT
  l.source,
  COUNT(*) AS leads_ingested,
  COUNT(*) FILTER (WHERE enrichment_status NOT LIKE 'disqualified%') AS leads_after_icp_filter,
  COUNT(*) FILTER (WHERE enrichment_status = 'enriched') AS leads_enriched,
  COUNT(*) FILTER (WHERE email IS NOT NULL AND enrichment_status NOT LIKE 'disqualified%') AS leads_with_email,
  COUNT(*) FILTER (WHERE dispatched_at IS NOT NULL) AS leads_sent,
  COUNT(*) FILTER (WHERE delivery_status = 'delivered') AS leads_delivered,
  COUNT(*) FILTER (WHERE dispatched_at IS NOT NULL AND delivery_status != 'bounced') AS leads_likely_delivered,
  COUNT(*) FILTER (WHERE delivery_status = 'bounced') AS leads_bounced,
  COUNT(*) FILTER (WHERE replied_at IS NOT NULL) AS leads_replied,
  SUM(rpl.order_count) AS orders,
  ROUND(SUM(rpl.revenue_cents) / 100.0, 2) AS revenue_dollars,
  
  ROUND(100.0 * COUNT(*) FILTER (WHERE enrichment_status NOT LIKE 'disqualified%') 
        / NULLIF(COUNT(*), 0), 1) AS pct_icp_pass,
  ROUND(100.0 * COUNT(*) FILTER (WHERE email IS NOT NULL AND enrichment_status NOT LIKE 'disqualified%') 
        / NULLIF(COUNT(*) FILTER (WHERE enrichment_status NOT LIKE 'disqualified%'), 0), 1) AS pct_enriched_of_icp,
  ROUND(100.0 * COUNT(*) FILTER (WHERE dispatched_at IS NOT NULL) 
        / NULLIF(COUNT(*) FILTER (WHERE email IS NOT NULL AND enrichment_status NOT LIKE 'disqualified%'), 0), 1) AS pct_sent_of_emailed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE replied_at IS NOT NULL) 
        / NULLIF(COUNT(*) FILTER (WHERE dispatched_at IS NOT NULL), 0), 1) AS pct_reply_rate,
  ROUND(100.0 * COUNT(*) FILTER (WHERE replied_at IS NOT NULL) 
        / NULLIF(COUNT(*) FILTER (WHERE dispatched_at IS NOT NULL AND delivery_status != 'bounced'), 0), 1) AS pct_reply_rate_of_delivered,
  ROUND(100.0 * COUNT(*) FILTER (WHERE delivery_status = 'bounced') 
        / NULLIF(COUNT(*) FILTER (WHERE dispatched_at IS NOT NULL), 0), 1) AS pct_bounce_rate,
  
  MIN(l.day_added) AS first_seen,
  MAX(l.day_added) AS last_seen,
  COUNT(DISTINCT l.day_added) AS days_active
FROM leads l
LEFT JOIN revenue_per_lead rpl ON rpl.lead_id = l.lead_id
GROUP BY l.source
ORDER BY leads_ingested DESC;

CREATE VIEW v_source_yield_decisions AS
SELECT
  source,
  leads_ingested,
  pct_icp_pass,
  pct_enriched_of_icp,
  pct_sent_of_emailed,
  leads_sent,
  leads_replied,
  pct_reply_rate,
  pct_reply_rate_of_delivered,
  pct_bounce_rate,
  revenue_dollars,
  first_seen,
  last_seen,
  days_active,
  CASE
    WHEN leads_sent >= 10 AND pct_bounce_rate > 10 THEN 'KILL_high_bounce'
    WHEN leads_ingested >= 30 AND pct_icp_pass < 30 THEN 'KILL_low_icp'
    WHEN leads_sent >= 30 AND leads_replied = 0 AND last_seen < CURRENT_DATE - 7 THEN 'KILL_no_replies'
    WHEN leads_replied >= 5 THEN 'SCALE'
    WHEN leads_sent >= 10 AND pct_reply_rate_of_delivered >= 10 THEN 'SCALE'
    WHEN leads_ingested < 20 THEN 'MEASURE'
    WHEN pct_icp_pass >= 60 AND leads_sent < 10 THEN 'MEASURE_promising'
    ELSE 'OPTIMIZE'
  END AS recommended_action,
  CASE
    WHEN leads_sent >= 10 AND pct_bounce_rate > 10 
      THEN 'Bounce rate ' || pct_bounce_rate || '% on ' || leads_sent || ' sent. Source has bad emails. Stop sending.'
    WHEN leads_ingested >= 30 AND pct_icp_pass < 30 
      THEN 'ICP pass only ' || pct_icp_pass || '% on ' || leads_ingested || ' leads. Burn this search.'
    WHEN leads_sent >= 30 AND leads_replied = 0 AND last_seen < CURRENT_DATE - 7
      THEN 'Sent ' || leads_sent || ', zero replies, source 7+ days old. Cold message or wrong audience.'
    WHEN leads_replied >= 5 
      THEN leads_replied || ' replies on ' || leads_sent || ' sent (' || COALESCE(pct_reply_rate_of_delivered::text, '0') || '% of delivered). Clone this search.'
    WHEN leads_sent >= 10 AND pct_reply_rate_of_delivered >= 10 
      THEN 'Reply rate ' || pct_reply_rate_of_delivered || '% of delivered (raw ' || COALESCE(pct_reply_rate::text, '0') || '%) on ' || leads_sent || ' sent. Top performer.'
    WHEN leads_ingested < 20 
      THEN 'Sample too small (' || leads_ingested || ' leads). Need 20+ to judge.'
    WHEN pct_icp_pass >= 60 AND leads_sent < 10 
      THEN 'ICP looks good (' || pct_icp_pass || '%). Wait for sends to confirm reply rate.'
    ELSE 'No clear signal yet. Watch the next 20 sends.'
  END AS reason
FROM v_source_yield
ORDER BY 
  CASE
    WHEN leads_replied >= 5 THEN 1
    WHEN leads_sent >= 10 AND pct_reply_rate_of_delivered >= 10 THEN 1
    WHEN leads_sent >= 10 AND pct_bounce_rate > 10 THEN 2
    WHEN leads_ingested >= 30 AND pct_icp_pass < 30 THEN 2
    WHEN leads_sent >= 30 AND leads_replied = 0 AND last_seen < CURRENT_DATE - 7 THEN 2
    WHEN pct_icp_pass >= 60 AND leads_sent < 10 THEN 3
    WHEN leads_ingested >= 20 THEN 4
    ELSE 5
  END,
  leads_ingested DESC;