-- Daily PostHog conversion snapshot. Tracks gate funnel health for May revenue target.

CREATE TABLE IF NOT EXISTS posthog_conversion_daily (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_days INTEGER NOT NULL DEFAULT 7,

  -- Funnel volume
  case_file_views_total INTEGER,
  case_file_views_unique INTEGER,

  -- Existing inline lock gate (cases.complianceworxs.com case file pages)
  lock_views_total INTEGER,
  lock_views_unique INTEGER,
  email_gate_shown_unique INTEGER,
  email_gate_submitted INTEGER,
  inline_gate_conversion_pct NUMERIC(5,2),

  -- New universal gate (slide-up on all case file scenario pages)
  universal_gate_shown INTEGER,
  universal_gate_submitted INTEGER,
  universal_gate_dismissed INTEGER,
  universal_gate_conversion_pct NUMERIC(5,2),

  -- New main-site gate (complianceworxs.com)
  main_gate_shown INTEGER,
  main_gate_submitted INTEGER,
  main_gate_dismissed INTEGER,
  main_gate_conversion_pct NUMERIC(5,2),

  -- Bottom of funnel
  cta_clicks_total INTEGER,
  email_captures_total INTEGER,
  purchases_total INTEGER,

  -- Top page diagnostics (which pages drove the most uncaptured traffic)
  top_uncaptured_pages JSONB,

  -- Pipeline noise check
  lead_enrichment_failed INTEGER,

  -- Raw event counts for any drift detection
  raw_event_counts JSONB,

  -- Diff vs prior snapshot (computed at insert)
  delta_vs_prior JSONB
);

CREATE INDEX IF NOT EXISTS idx_posthog_conv_captured_at ON posthog_conversion_daily(captured_at DESC);

COMMENT ON TABLE posthog_conversion_daily IS 'Daily PostHog funnel snapshot. Populated by posthog-conversion-monitor edge function via pg_cron.';