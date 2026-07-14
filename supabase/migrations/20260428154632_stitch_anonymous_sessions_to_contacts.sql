-- ════════════════════════════════════════════════════════════
-- IDENTITY STITCHING — anonymous sessions → named contacts
-- For each named contact, find every session that submitted that
-- email, aggregate behavioral data from events tied to those
-- sessions, write totals to lead_intents.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION stitch_contact_behavior()
RETURNS TABLE(contacts_updated INT, total_sessions_attributed INT)
LANGUAGE plpgsql
AS $$
DECLARE
  contact_count INT := 0;
  session_count INT := 0;
BEGIN
  WITH email_sessions AS (
    -- Every session_id where the email matches a known contact
    SELECT DISTINCT
      s.session_id,
      LOWER(TRIM(s.email)) AS norm_email
    FROM sessions s
    WHERE s.email IS NOT NULL
      AND s.email <> ''
  ),
  contact_session_map AS (
    -- Tie sessions to contact_id via normalized email
    SELECT
      c.id AS contact_id,
      es.session_id
    FROM email_sessions es
    JOIN contacts c
      ON c.normalized_email = es.norm_email
      OR LOWER(c.email) = es.norm_email
  ),
  behavior_rollup AS (
    -- Aggregate events across every session belonging to a contact
    SELECT
      csm.contact_id,
      COUNT(DISTINCT csm.session_id) AS session_count,
      COUNT(DISTINCT e.id) FILTER (WHERE e.event_name = 'page_view') AS page_views,
      COUNT(DISTINCT e.id) FILTER (WHERE e.event_name IN ('lock_view', 'ddr_lock_view', 'capa_lock_view', 'batch_lock_view')) AS lock_views,
      COUNT(DISTINCT e.id) FILTER (WHERE e.event_name IN ('cta_click', 'stripe_redirect_clicked', 'checkout_clicked')) AS cta_clicks,
      COUNT(DISTINCT e.id) FILTER (WHERE e.event_name IN ('checkout_redirect', 'stripe_redirected')) AS checkout_redirects,
      MAX(e.created_at) AS last_event_at,
      MAX(e.page) FILTER (WHERE e.page LIKE '%case-file%' OR e.page LIKE '%/cases.%')
        AS last_case_file_seen
    FROM contact_session_map csm
    LEFT JOIN events e ON e.session_id = csm.session_id
    GROUP BY csm.contact_id
  )
  INSERT INTO lead_intents (
    contact_id,
    return_visits,
    lock_viewed,
    cta_clicked,
    last_case_file_slug,
    last_activity_at,
    high_intent,
    updated_at
  )
  SELECT
    br.contact_id,
    GREATEST(br.session_count - 1, 0)::INT AS return_visits,  -- first visit doesn't count as a return
    (br.lock_views > 0) AS lock_viewed,
    (br.cta_clicks > 0) AS cta_clicked,
    br.last_case_file_seen,
    br.last_event_at,
    -- High intent: 2+ return visits OR checkout redirect OR 3+ lock views
    (
      GREATEST(br.session_count - 1, 0) >= 2
      OR br.checkout_redirects > 0
      OR br.lock_views >= 3
    ) AS high_intent,
    NOW()
  FROM behavior_rollup br
  WHERE br.contact_id IS NOT NULL
  ON CONFLICT (contact_id) DO UPDATE SET
    return_visits      = EXCLUDED.return_visits,
    lock_viewed        = EXCLUDED.lock_viewed OR lead_intents.lock_viewed,
    cta_clicked        = EXCLUDED.cta_clicked OR lead_intents.cta_clicked,
    last_case_file_slug = COALESCE(EXCLUDED.last_case_file_slug, lead_intents.last_case_file_slug),
    last_activity_at   = GREATEST(COALESCE(EXCLUDED.last_activity_at, lead_intents.last_activity_at), lead_intents.last_activity_at),
    high_intent        = EXCLUDED.high_intent OR lead_intents.high_intent,
    updated_at         = NOW();

  GET DIAGNOSTICS contact_count = ROW_COUNT;

  SELECT COUNT(*) INTO session_count
  FROM sessions
  WHERE email IS NOT NULL AND email <> '';

  contacts_updated := contact_count;
  total_sessions_attributed := session_count;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION stitch_contact_behavior IS
  'Stitches anonymous session behavioral data to named contacts via email match. Run hourly via pg_cron.';