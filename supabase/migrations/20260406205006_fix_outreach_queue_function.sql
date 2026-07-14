
-- Fix populate function — queue leads by email directly, no session join required
CREATE OR REPLACE FUNCTION public.populate_outreach_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
    AND l.email NOT ILIKE '%test%'
    AND l.email NOT ILIKE '%zapier%'
    AND l.source != 'disqualified'
    AND COALESCE(us.purchases, 0) = 0
    -- Not in purchases table directly either
    AND l.email NOT IN (SELECT email FROM public.purchases)
    -- Not contacted in last 7 days
    AND l.email NOT IN (
      SELECT email FROM public.outreach_log
      WHERE sent_at >= now() - interval '7 days'
    )
    -- Not already pending
    AND l.email NOT IN (
      SELECT email FROM public.outreach_queue WHERE status = 'pending'
    )
  ORDER BY l.created_at DESC;
END;
$$;

-- Run it now
SELECT public.populate_outreach_queue();
