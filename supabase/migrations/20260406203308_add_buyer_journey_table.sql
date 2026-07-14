
CREATE TABLE IF NOT EXISTS public.buyer_journey (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  email text,
  is_buyer boolean DEFAULT false,
  num_lock_views integer DEFAULT 0,
  num_cta_clicks integer DEFAULT 0,
  num_visits integer DEFAULT 0,
  intent_score numeric DEFAULT 0,
  hesitation_score numeric DEFAULT 0,
  time_to_purchase interval,
  purchased_at timestamptz,
  first_seen_ts timestamptz,
  last_seen_ts timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buyer_journey_is_buyer ON public.buyer_journey(is_buyer);
CREATE INDEX IF NOT EXISTS idx_buyer_journey_user_id ON public.buyer_journey(user_id);
