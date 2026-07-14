
CREATE TABLE IF NOT EXISTS public.daily_intelligence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at timestamptz DEFAULT now(),
  
  -- Revenue
  total_revenue_cents integer DEFAULT 0,
  total_purchases integer DEFAULT 0,
  new_purchases_today integer DEFAULT 0,
  
  -- Funnel
  total_lock_views integer DEFAULT 0,
  total_cta_clicks integer DEFAULT 0,
  lock_to_cta_rate numeric DEFAULT 0,
  cta_to_purchase_rate numeric DEFAULT 0,
  
  -- Pipeline
  high_intent_users integer DEFAULT 0,
  emails_captured integer DEFAULT 0,
  unconverted_cta_clicks integer DEFAULT 0,
  
  -- Top prospect
  top_prospect_user_id text,
  top_prospect_intent numeric,
  top_prospect_last_action text,
  top_prospect_last_seen timestamptz,
  top_prospect_email text,
  
  -- Action queue (JSON array of users needing action)
  action_queue jsonb DEFAULT '[]'::jsonb,
  
  -- Scoring health
  avg_intent_score numeric DEFAULT 0,
  avg_conversion_probability numeric DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_daily_intelligence_generated_at 
  ON public.daily_intelligence(generated_at DESC);
