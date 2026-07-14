
-- Drop and recreate buyer_journey to exact spec schema
DROP TABLE IF EXISTS public.buyer_journey;

CREATE TABLE public.buyer_journey (
  user_id TEXT PRIMARY KEY,
  num_lock_views INT,
  num_cta_clicks INT,
  num_sessions INT,
  time_to_purchase_seconds INT,
  first_event TIMESTAMP,
  purchase_event TIMESTAMP
);

-- Drop and recreate action_log to exact spec schema
DROP TABLE IF EXISTS public.action_log;

CREATE TABLE public.action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  action_taken TEXT,
  strategy TEXT,
  timestamp TIMESTAMP DEFAULT now(),
  result TEXT,
  time_to_conversion_seconds INT
);

-- Add is_buyer to user_state if not exists (needed for buyer comparison query)
ALTER TABLE public.user_state ADD COLUMN IF NOT EXISTS is_buyer BOOLEAN DEFAULT false;

-- Mark existing known buyer
UPDATE public.user_state us
SET is_buyer = true
WHERE EXISTS (
  SELECT 1 FROM public.purchases p
  WHERE p.email = (SELECT l.email FROM public.leads l WHERE l.session_id = us.user_id LIMIT 1)
);
