
-- Step 3: Populate lead_intents by aggregating events per contact via session_id join
INSERT INTO lead_intents (
  contact_id,
  assessment_started,
  assessment_completed,
  lock_viewed,
  cta_clicked,
  return_visits,
  high_intent,
  last_case_file_slug,
  last_activity_at,
  created_at,
  updated_at
)
SELECT
  c.id AS contact_id,

  -- Did this session include a form_start?
  BOOL_OR(e.event_name = 'form_start') AS assessment_started,

  -- No assessment completion signal in events currently
  FALSE AS assessment_completed,

  -- Did they hit the lock?
  BOOL_OR(e.event_name = 'lock_view') AS lock_viewed,

  -- Did they click a CTA?
  BOOL_OR(e.event_name = 'cta_click') AS cta_clicked,

  -- How many return_visit events?
  COUNT(CASE WHEN e.event_name = 'return_visit' THEN 1 END)::integer AS return_visits,

  -- High intent = hit direct checkout redirect
  BOOL_OR(e.event_name = 'direct_checkout_redirect') AS high_intent,

  -- Last case file page visited
  (
    SELECT e2.page FROM events e2
    WHERE e2.session_id = l.session_id
      AND e2.event_name = 'case_file_view'
    ORDER BY e2.created_at DESC
    LIMIT 1
  ) AS last_case_file_slug,

  MAX(e.created_at) AS last_activity_at,
  NOW() AS created_at,
  NOW() AS updated_at

FROM contacts c
JOIN leads l ON lower(trim(c.email)) = lower(trim(l.email))
JOIN events e ON l.session_id = e.session_id
WHERE l.session_id IS NOT NULL
GROUP BY c.id, l.session_id, l.email
ON CONFLICT (contact_id) DO UPDATE SET
  lock_viewed      = EXCLUDED.lock_viewed OR lead_intents.lock_viewed,
  cta_clicked      = EXCLUDED.cta_clicked OR lead_intents.cta_clicked,
  high_intent      = EXCLUDED.high_intent OR lead_intents.high_intent,
  return_visits    = EXCLUDED.return_visits + lead_intents.return_visits,
  last_activity_at = GREATEST(EXCLUDED.last_activity_at, lead_intents.last_activity_at),
  updated_at       = NOW();
