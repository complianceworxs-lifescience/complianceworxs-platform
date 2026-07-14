
-- Outreach queue: tracks who needs contact and what was sent
CREATE TABLE IF NOT EXISTS public.outreach_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  user_id text,
  case_file text,
  intent_score numeric,
  trigger_reason text, -- why they were queued
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  queued_at timestamptz DEFAULT now(),
  sent_at timestamptz,
  email_subject text,
  email_body text
);

-- Outreach log: permanent record of every email sent
CREATE TABLE IF NOT EXISTS public.outreach_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  user_id text,
  subject text,
  trigger_reason text,
  sent_at timestamptz DEFAULT now(),
  result text DEFAULT 'sent'
);

CREATE INDEX IF NOT EXISTS idx_outreach_queue_status ON public.outreach_queue(status);
CREATE INDEX IF NOT EXISTS idx_outreach_queue_email ON public.outreach_queue(email);
CREATE INDEX IF NOT EXISTS idx_outreach_log_email ON public.outreach_log(email);

-- Function that runs daily to populate outreach queue
-- Queues anyone with email + high intent who hasn't been contacted in 7 days
CREATE OR REPLACE FUNCTION public.populate_outreach_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.outreach_queue (email, user_id, case_file, intent_score, trigger_reason)
  SELECT DISTINCT ON (l.email)
    l.email,
    us.user_id,
    l.case_file,
    us.intent_score,
    CASE
      WHEN us.cta_clicks > 0 AND us.purchases = 0 THEN 'cta_no_purchase'
      WHEN us.locks_encountered >= 3 AND us.purchases = 0 THEN 'high_lock_views'
      WHEN us.intent_score >= 70 THEN 'high_intent'
      ELSE 'email_captured'
    END as trigger_reason
  FROM public.leads l
  JOIN public.user_state us ON l.session_id = us.user_id
  WHERE 
    l.email IS NOT NULL
    AND l.email NOT ILIKE '%complianceworxs%'
    AND l.email NOT ILIKE '%test%'
    AND l.email NOT ILIKE '%zapier%'
    AND us.purchases = 0
    AND us.intent_score >= 20
    -- Not already contacted in last 7 days
    AND l.email NOT IN (
      SELECT email FROM public.outreach_log
      WHERE sent_at >= now() - interval '7 days'
    )
    -- Not already pending in queue
    AND l.email NOT IN (
      SELECT email FROM public.outreach_queue
      WHERE status = 'pending'
    )
  ORDER BY l.email, us.priority_score DESC
  ON CONFLICT DO NOTHING;
END;
$$;

-- Schedule queue population daily at 6:05am UTC (just after intelligence refresh)
SELECT cron.schedule(
  'populate-outreach-queue',
  '5 6 * * *',
  'SELECT public.populate_outreach_queue()'
);

-- Run it now to populate immediately
SELECT public.populate_outreach_queue();
