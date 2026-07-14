
-- ── VIEW 1: Purchase Report ────────────────────────────────────────────────
-- Orders joined to contacts + pre-purchase behavioral signals.
-- Falls back to purchases table until orders has data.
CREATE OR REPLACE VIEW v_purchase_report AS

-- Confirmed orders (post-webhook-fix)
SELECT
  o.id                          AS order_id,
  c.email,
  c.full_name,
  c.company,
  c.job_title,
  o.product_sku                 AS product,
  o.amount_cents / 100.0        AS amount_usd,
  o.order_status                AS status,
  o.purchased_at,
  -- Pre-purchase signals from lead_intents
  li.lock_viewed,
  li.cta_clicked,
  li.return_visits,
  li.high_intent,
  li.last_case_file_slug        AS last_case_file,
  -- Was this person a lead before buying?
  CASE WHEN l.id IS NOT NULL THEN TRUE ELSE FALSE END AS was_lead_first,
  l.source                      AS lead_source,
  l.utm_source,
  l.utm_campaign,
  'orders'                      AS record_source
FROM orders o
JOIN contacts c ON c.id = o.contact_id
LEFT JOIN lead_intents li ON li.contact_id = c.id
LEFT JOIN leads l ON lower(trim(l.email)) = c.normalized_email

UNION ALL

-- Legacy purchases (pre-webhook, unknown email excluded)
SELECT
  p.id                          AS order_id,
  p.email,
  c.full_name,
  c.company,
  c.job_title,
  p.case_file_id                AS product,
  149.00                        AS amount_usd,
  'completed'                   AS status,
  p.purchased_at,
  li.lock_viewed,
  li.cta_clicked,
  li.return_visits,
  li.high_intent,
  li.last_case_file_slug        AS last_case_file,
  CASE WHEN l.id IS NOT NULL THEN TRUE ELSE FALSE END AS was_lead_first,
  l.source                      AS lead_source,
  l.utm_source,
  l.utm_campaign,
  'purchases_legacy'            AS record_source
FROM purchases p
LEFT JOIN contacts c ON c.normalized_email = lower(trim(p.email))
LEFT JOIN lead_intents li ON li.contact_id = c.id
LEFT JOIN leads l ON lower(trim(l.email)) = lower(trim(p.email))
WHERE p.email != 'unknown'
-- Exclude any that already appear in orders
AND NOT EXISTS (
  SELECT 1 FROM orders o
  JOIN contacts oc ON oc.id = o.contact_id
  WHERE oc.normalized_email = lower(trim(p.email))
);


-- ── VIEW 2: Lead Intent Dashboard ─────────────────────────────────────────
-- Warm lead list ranked by intent signal. Use this for DM outreach.
CREATE OR REPLACE VIEW v_lead_intent_dashboard AS
SELECT
  c.email,
  c.full_name,
  c.company,
  c.job_title,
  c.lifecycle_stage,
  -- Intent signals
  COALESCE(li.high_intent,    FALSE) AS checkout_redirected,
  COALESCE(li.cta_clicked,    FALSE) AS cta_clicked,
  COALESCE(li.lock_viewed,    FALSE) AS lock_viewed,
  COALESCE(li.return_visits,  0)     AS return_visits,
  li.last_case_file_slug             AS last_case_file,
  li.last_activity_at,
  -- Lead context
  l.source                           AS capture_source,
  l.utm_source,
  l.utm_campaign,
  l.session_id,
  -- Event counts from behavioral tracking
  (SELECT COUNT(*) FROM events e WHERE e.session_id = l.session_id) AS total_events,
  (SELECT COUNT(*) FROM events e WHERE e.session_id = l.session_id AND e.event_name = 'lock_view') AS lock_views,
  (SELECT COUNT(*) FROM events e WHERE e.session_id = l.session_id AND e.event_name = 'return_visit') AS tracked_return_visits,
  -- Composite intent score (0–5)
  (
    CASE WHEN COALESCE(li.high_intent,   FALSE) THEN 2 ELSE 0 END +
    CASE WHEN COALESCE(li.cta_clicked,   FALSE) THEN 2 ELSE 0 END +
    CASE WHEN COALESCE(li.lock_viewed,   FALSE) THEN 1 ELSE 0 END
  )                                  AS intent_score,
  -- Is buyer?
  COALESCE(l.is_buyer, FALSE)        AS is_buyer,
  c.created_at                       AS contact_created_at
FROM contacts c
LEFT JOIN lead_intents li ON li.contact_id = c.id
LEFT JOIN leads l ON lower(trim(l.email)) = c.normalized_email
WHERE c.lifecycle_stage != 'buyer'   -- exclude existing buyers
  AND c.email NOT LIKE '%complianceworxs%'
  AND c.email NOT LIKE '%coursworx%'
ORDER BY intent_score DESC, li.last_activity_at DESC NULLS LAST;


-- ── VIEW 3: Session Conversion Funnel ─────────────────────────────────────
-- Session-level funnel: page view → lock hit → email captured.
-- Primary metric: of sessions that hit a lock, how many converted to a lead.
CREATE OR REPLACE VIEW v_session_conversion AS
SELECT
  e.page,
  COUNT(DISTINCT e.session_id)                                                AS total_sessions,
  COUNT(DISTINCT CASE WHEN e.event_name = 'lock_view'  THEN e.session_id END) AS lock_views,
  COUNT(DISTINCT CASE WHEN e.event_name = 'cta_click'  THEN e.session_id END) AS cta_clicks,
  COUNT(DISTINCT CASE WHEN e.event_name = 'direct_checkout_redirect' THEN e.session_id END) AS checkout_redirects,
  -- Sessions that became identified leads
  COUNT(DISTINCT l.session_id)                                                AS identified_leads,
  -- Lock-to-lead conversion rate
  ROUND(
    COUNT(DISTINCT l.session_id)::numeric /
    NULLIF(COUNT(DISTINCT CASE WHEN e.event_name = 'lock_view' THEN e.session_id END), 0) * 100,
    1
  )                                                                           AS lock_to_lead_pct,
  -- CTA-to-checkout rate
  ROUND(
    COUNT(DISTINCT CASE WHEN e.event_name = 'direct_checkout_redirect' THEN e.session_id END)::numeric /
    NULLIF(COUNT(DISTINCT CASE WHEN e.event_name = 'cta_click' THEN e.session_id END), 0) * 100,
    1
  )                                                                           AS cta_to_checkout_pct
FROM events e
LEFT JOIN leads l ON l.session_id = e.session_id
WHERE e.page NOT IN ('/verify', '/test')
GROUP BY e.page
ORDER BY total_sessions DESC;
