-- ============================================================================
-- v_source_yield: Per-source funnel telemetry
-- v_source_yield_decisions: Adds KILL/SCALE/MEASURE/OPTIMIZE classification
-- 
-- These are real-time views over warm_outbound_staging joined to contacts and
-- orders. No cron needed; query whenever you want fresh data.
-- ============================================================================

CREATE OR REPLACE VIEW v_source_yield AS
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
    created_at::date AS day_added,
    -- Week stamp so we can see week-over-week per source
    TO_CHAR(created_at, 'IYYY"W"IW') AS week_added
  FROM warm_outbound_staging
  WHERE archived_at IS NULL
),
-- Match each lead to revenue: warm.email -> contacts.email -> orders.contact_id
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
  -- Volume
  COUNT(*) AS leads_ingested,
  COUNT(*) FILTER (WHERE enrichment_status NOT LIKE 'disqualified%') AS leads_after_icp_filter,
  COUNT(*) FILTER (WHERE enrichment_status = 'enriched') AS leads_enriched,
  COUNT(*) FILTER (WHERE email IS NOT NULL) AS leads_with_email,
  COUNT(*) FILTER (WHERE dispatched_at IS NOT NULL) AS leads_sent,
  COUNT(*) FILTER (WHERE delivery_status = 'delivered') AS leads_delivered,
  COUNT(*) FILTER (WHERE delivery_status = 'bounced') AS leads_bounced,
  COUNT(*) FILTER (WHERE replied_at IS NOT NULL) AS leads_replied,
  SUM(rpl.order_count) AS orders,
  ROUND(SUM(rpl.revenue_cents) / 100.0, 2) AS revenue_dollars,
  
  -- Conversion rates (NULL when denominator is 0 instead of dividing by zero)
  ROUND(100.0 * COUNT(*) FILTER (WHERE enrichment_status NOT LIKE 'disqualified%') 
        / NULLIF(COUNT(*), 0), 1) AS pct_icp_pass,
  ROUND(100.0 * COUNT(*) FILTER (WHERE email IS NOT NULL) 
        / NULLIF(COUNT(*) FILTER (WHERE enrichment_status NOT LIKE 'disqualified%'), 0), 1) AS pct_enriched_of_icp,
  ROUND(100.0 * COUNT(*) FILTER (WHERE dispatched_at IS NOT NULL) 
        / NULLIF(COUNT(*) FILTER (WHERE email IS NOT NULL), 0), 1) AS pct_sent_of_emailed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE replied_at IS NOT NULL) 
        / NULLIF(COUNT(*) FILTER (WHERE dispatched_at IS NOT NULL), 0), 1) AS pct_reply_rate,
  ROUND(100.0 * COUNT(*) FILTER (WHERE delivery_status = 'bounced') 
        / NULLIF(COUNT(*) FILTER (WHERE dispatched_at IS NOT NULL), 0), 1) AS pct_bounce_rate,
  
  -- Time bounds for this source
  MIN(l.day_added) AS first_seen,
  MAX(l.day_added) AS last_seen,
  COUNT(DISTINCT l.day_added) AS days_active
FROM leads l
LEFT JOIN revenue_per_lead rpl ON rpl.lead_id = l.lead_id
GROUP BY l.source
ORDER BY leads_ingested DESC;

COMMENT ON VIEW v_source_yield IS 
  'Per-source funnel: ingested -> ICP -> enriched -> emailed -> sent -> replied -> revenue. Real-time.';

-- ============================================================================
-- v_source_yield_decisions: classifier on top
-- Rules are explicit, transparent, easy to tune
-- ============================================================================
CREATE OR REPLACE VIEW v_source_yield_decisions AS
SELECT
  source,
  leads_ingested,
  pct_icp_pass,
  pct_enriched_of_icp,
  pct_sent_of_emailed,
  leads_sent,
  leads_replied,
  pct_reply_rate,
  revenue_dollars,
  first_seen,
  last_seen,
  days_active,
  
  -- Decision classifier (priority order: KILL beats SCALE beats OPTIMIZE)
  CASE
    -- Not enough data yet (don't make calls on tiny samples)
    WHEN leads_ingested < 20 THEN 'MEASURE'
    
    -- Catastrophic ICP failure: 30+ leads, less than 30% ICP pass
    WHEN leads_ingested >= 30 AND pct_icp_pass < 30 
      THEN 'KILL_low_icp'
    
    -- Hard delivery failure: bounce rate above 10% on a meaningful sample
    WHEN leads_sent >= 10 AND pct_bounce_rate > 10 
      THEN 'KILL_high_bounce'
    
    -- Cold source: 30+ sent, zero replies (after a normal reply window has passed)
    WHEN leads_sent >= 30 AND leads_replied = 0 AND last_seen < CURRENT_DATE - 7
      THEN 'KILL_no_replies'
    
    -- Strong reply rate: above 5% on a meaningful sample
    WHEN leads_sent >= 20 AND pct_reply_rate >= 5 
      THEN 'SCALE'
    
    -- Decent ICP, no signal yet on replies (sample too small)
    WHEN pct_icp_pass >= 60 AND leads_sent < 20 
      THEN 'MEASURE_promising'
    
    -- Default: keep but optimize (low ICP pass rate but not catastrophic, or no clear winner)
    ELSE 'OPTIMIZE'
  END AS recommended_action,
  
  -- Human-readable reason for the action
  CASE
    WHEN leads_ingested < 20 
      THEN 'Sample too small - need 20+ leads before judging'
    WHEN leads_ingested >= 30 AND pct_icp_pass < 30 
      THEN 'ICP pass rate ' || COALESCE(pct_icp_pass::text, '0') || '% - source is mostly junk'
    WHEN leads_sent >= 10 AND pct_bounce_rate > 10 
      THEN 'Bounce rate ' || COALESCE(pct_bounce_rate::text, '0') || '% - bad email quality'
    WHEN leads_sent >= 30 AND leads_replied = 0 AND last_seen < CURRENT_DATE - 7
      THEN 'Sent ' || leads_sent || ', zero replies - cold message or wrong audience'
    WHEN leads_sent >= 20 AND pct_reply_rate >= 5 
      THEN 'Reply rate ' || pct_reply_rate || '% on ' || leads_sent || ' sent - clone this search'
    WHEN pct_icp_pass >= 60 AND leads_sent < 20 
      THEN 'ICP looks good (' || pct_icp_pass || '%), wait for sends to confirm'
    ELSE 'Mixed signal - keep running, watch reply rate'
  END AS reason
FROM v_source_yield
ORDER BY 
  CASE
    WHEN leads_ingested < 20 THEN 4
    WHEN leads_sent >= 20 AND pct_reply_rate >= 5 THEN 1   -- SCALE first
    WHEN leads_ingested >= 30 AND pct_icp_pass < 30 THEN 2 -- KILL second
    ELSE 3
  END,
  leads_ingested DESC;

COMMENT ON VIEW v_source_yield_decisions IS 
  'v_source_yield + KILL/SCALE/MEASURE/OPTIMIZE classifier. Rules in CASE statement above.';

SELECT 'views created' AS status;