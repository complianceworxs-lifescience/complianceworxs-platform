
-- action_log: every trigger recorded with outcome
CREATE TABLE IF NOT EXISTS public.action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  action_taken text NOT NULL,
  strategy text,
  buyer_state text,
  intent_score numeric,
  hesitation_score numeric,
  conversion_probability numeric,
  result text DEFAULT 'pending' CHECK (result IN ('pending', 'purchase', 'no_action', 'bounce')),
  time_to_conversion interval,
  triggered_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

-- action_performance: conversion rate per action type
CREATE TABLE IF NOT EXISTS public.action_performance (
  action_type text PRIMARY KEY,
  impressions integer DEFAULT 0,
  conversions integer DEFAULT 0,
  conversion_rate numeric GENERATED ALWAYS AS (
    CASE WHEN impressions = 0 THEN 0
    ELSE ROUND((conversions::numeric / impressions::numeric), 4)
    END
  ) STORED,
  dynamic_threshold numeric DEFAULT 70,
  updated_at timestamptz DEFAULT now()
);

-- seed action_performance with all 7 action types
INSERT INTO public.action_performance (action_type) VALUES
  ('no_action'),
  ('show_standard_cta'),
  ('increase_urgency_messaging'),
  ('trigger_direct_purchase_prompt'),
  ('show_objection_handling'),
  ('send_followup_email'),
  ('retarget_with_specific_case')
ON CONFLICT (action_type) DO NOTHING;

-- add priority_score to user_state
ALTER TABLE public.user_state 
  ADD COLUMN IF NOT EXISTS priority_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recency_weight numeric DEFAULT 1.0;

-- compute initial priority scores based on existing data
-- priority = conversion_prob × (1 - hesitation_weight) × recency_weight
-- recency_weight decays by days since last_seen (max 1.0, min 0.1)
UPDATE public.user_state SET
  recency_weight = GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (now() - last_seen_ts)) / 86400.0 / 30.0)),
  priority_score = ROUND(
    (LEAST(1, GREATEST(0, (intent_score - hesitation_score) / 100.0))
    * GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (now() - last_seen_ts)) / 86400.0 / 30.0))
    * CASE WHEN hesitation_score > 0 THEN GREATEST(0.1, 1.0 - (hesitation_score / 200.0)) ELSE 1.0 END
    )::numeric, 4
  );

-- index for fast queue pulls
CREATE INDEX IF NOT EXISTS idx_action_log_user_id ON public.action_log(user_id);
CREATE INDEX IF NOT EXISTS idx_action_log_result ON public.action_log(result);
CREATE INDEX IF NOT EXISTS idx_user_state_priority ON public.user_state(priority_score DESC);
