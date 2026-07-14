
-- Step 1: Drop the dead outreach_log table (0 rows, never used)
DROP TABLE IF EXISTS public.outreach_log;

-- Step 2: Rewrite populate_outreach_queue() with correct table + column names
-- and broader deduplication logic
CREATE OR REPLACE FUNCTION public.populate_outreach_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.outreach_queue (email, user_id, case_file, intent_score, trigger_reason)
  SELECT
    l.email,
    l.session_id,
    l.case_file,
    COALESCE(us.intent_score, 20) as intent_score,
    CASE
      WHEN l.source = 'lock_overlay' THEN 'cta_no_purchase'
      WHEN l.source ILIKE '%assessment%' THEN 'assessment_completed'
      WHEN us.cta_clicks > 0 THEN 'cta_no_purchase'
      WHEN us.locks_encountered >= 3 THEN 'high_lock_views'
      ELSE 'email_captured'
    END as trigger_reason
  FROM public.leads l
  LEFT JOIN public.user_state us ON l.session_id = us.user_id
  WHERE
    l.email IS NOT NULL
    AND l.email NOT ILIKE '%complianceworxs%'
    AND l.email NOT ILIKE '%coursworx%'
    AND l.email NOT ILIKE '%test%'
    AND l.email NOT ILIKE '%zapier%'
    AND l.email NOT ILIKE '%example.com%'
    AND l.source != 'disqualified'
    AND COALESCE(us.purchases, 0) = 0
    -- Already a buyer
    AND l.email NOT IN (SELECT email FROM public.purchases)
    -- Already drafted or sent in the last 30 days (check real log table)
    AND l.email NOT IN (
      SELECT lead_email FROM public.lead_outreach_log
      WHERE sent_at >= now() - interval '30 days'
    )
    -- Already in the queue in ANY status in the last 30 days
    -- (catches: pending, sent, skipped, drafted — anything recent)
    AND l.email NOT IN (
      SELECT email FROM public.outreach_queue
      WHERE queued_at >= now() - interval '30 days'
    )
  ORDER BY l.created_at DESC;
END;
$function$;
