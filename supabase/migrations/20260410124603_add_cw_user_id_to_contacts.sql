
ALTER TABLE public.contacts
ADD COLUMN IF NOT EXISTS cw_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_cw_user_id
ON public.contacts (cw_user_id);

CREATE OR REPLACE VIEW user_behavior_report AS
SELECT
  c.email,
  c.cw_user_id,
  c.lifecycle_stage,
  c.created_at          AS contact_created_at,
  us.current_strategy,
  us.visits,
  us.locks_encountered,
  us.cta_clicks,
  us.intent_score,
  us.is_buyer,
  us.last_seen_ts       AS last_behavior_ts
FROM public.contacts c
LEFT JOIN public.user_state us ON us.user_id = c.cw_user_id;
