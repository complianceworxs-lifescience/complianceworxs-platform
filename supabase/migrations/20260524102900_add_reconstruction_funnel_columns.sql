-- Add reconstruction diagnostic funnel columns to the daily snapshot.
-- The /reconstruction page is its own funnel — not a gate — so it needs its own surface.
ALTER TABLE posthog_conversion_daily
  ADD COLUMN IF NOT EXISTS reconstruction_pageviews_unique INTEGER,
  ADD COLUMN IF NOT EXISTS reconstruction_terms_accepted INTEGER,
  ADD COLUMN IF NOT EXISTS reconstruction_decision_selected INTEGER,
  ADD COLUMN IF NOT EXISTS reconstruction_coming_soon_shown INTEGER,
  ADD COLUMN IF NOT EXISTS reconstruction_capa_started INTEGER,
  ADD COLUMN IF NOT EXISTS reconstruction_completed INTEGER,
  ADD COLUMN IF NOT EXISTS reconstruction_routed INTEGER,
  ADD COLUMN IF NOT EXISTS reconstruction_completion_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS reconstruction_route_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS reconstruction_dead_dropdown_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS reconstruction_observation_breakdown JSONB;