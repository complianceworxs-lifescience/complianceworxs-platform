
CREATE OR REPLACE VIEW warm_leads_dm_list AS
WITH lead_signals AS (
  SELECT
    e.session_id,
    e.page AS case_file,
    COUNT(*) FILTER (WHERE e.event_name = 'return_visit') AS return_visits,
    COUNT(*) FILTER (WHERE e.event_name = 'cta_click') AS cta_clicks,
    COUNT(*) FILTER (WHERE e.event_name = 'direct_checkout_redirect') AS checkout_attempts,
    COUNT(*) FILTER (WHERE e.event_name = 'lock_view') AS lock_views,
    COUNT(*) FILTER (WHERE e.event_name = 'exit_intent') AS exit_intents,
    MAX(e.created_at) AS last_seen
  FROM events e
  GROUP BY e.session_id, e.page
),
scored AS (
  SELECT
    ls.*,
    -- Warmth score: weight by signal quality
    (ls.cta_clicks * 5)
    + (ls.checkout_attempts * 8)
    + (ls.lock_views * 3)
    + (ls.return_visits * 2)
    + (ls.exit_intents * 1) AS warmth_score
  FROM lead_signals ls
  WHERE
    -- Must have at least one meaningful signal
    (ls.cta_clicks > 0 OR ls.checkout_attempts > 0 OR ls.return_visits > 0 OR ls.lock_views >= 2)
),
enriched AS (
  SELECT
    s.warmth_score,
    s.case_file,
    s.return_visits,
    s.cta_clicks,
    s.checkout_attempts,
    s.lock_views,
    s.exit_intents,
    s.last_seen,
    l.email,
    l.name,
    l.title,
    l.company,
    -- Flag if already in outreach queue or sent
    oq.status AS outreach_status
  FROM scored s
  LEFT JOIN leads l ON l.session_id = s.session_id
  -- Exclude buyers
  LEFT JOIN purchases p ON p.email = l.email
  LEFT JOIN outreach_queue oq ON oq.email = l.email
  WHERE p.id IS NULL  -- not a buyer
)
SELECT
  warmth_score,
  COALESCE(name, 'Unknown') AS name,
  COALESCE(email, 'No email captured') AS email,
  COALESCE(title, '—') AS title,
  COALESCE(company, '—') AS company,
  case_file,
  return_visits,
  cta_clicks,
  checkout_attempts,
  lock_views,
  last_seen::date AS last_seen,
  COALESCE(outreach_status, 'not contacted') AS outreach_status,
  -- DM context hint
  CASE
    WHEN checkout_attempts > 0 THEN 'Was 60 seconds from buying — reference the specific case file'
    WHEN cta_clicks > 0 THEN 'Clicked CTA but didn''t convert — objection or friction, not disinterest'
    WHEN return_visits > 0 AND lock_views >= 2 THEN 'Hit the paywall on a return visit — price or trust gap'
    WHEN return_visits > 0 THEN 'Came back without prompting — something resonated'
    ELSE 'Repeated paywall exposure — knows the product exists'
  END AS dm_context
FROM enriched
ORDER BY warmth_score DESC, last_seen DESC;
