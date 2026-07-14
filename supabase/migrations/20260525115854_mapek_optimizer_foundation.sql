-- =========================================================
-- MAPE-K Outbound Optimizer Foundation
-- =========================================================

-- Seed initial config (current operating values) into existing table
INSERT INTO optimizer_config (key, value, reasoning) VALUES
  ('fit_score_threshold', '70'::jsonb, 'Minimum fit_score to qualify for outbound DM'),
  ('daily_dm_budget', '10'::jsonb, 'Max DMs sent per business day'),
  ('default_opener_template', '"authorization_logic_v1"'::jsonb, 'Active DM opener archetype'),
  ('paused_cohorts', '[]'::jsonb, 'Cohort labels currently paused from outbound'),
  ('min_accept_rate_threshold', '0.15'::jsonb, 'Cohort acceptance rate below which it gets auto-paused'),
  ('readiness_min_description_chars', '40'::jsonb, 'Min LinkedIn description chars for personalization gate'),
  ('readiness_allow_fallback', 'true'::jsonb, 'Allow no-personalization opener when LinkedIn data is thin'),
  ('optimizer_mode', '"shadow"'::jsonb, 'shadow | live | disabled'),
  ('optimizer_shadow_started_at', to_jsonb(NOW()::text), 'When shadow mode began'),
  ('optimizer_live_after', to_jsonb((NOW() + INTERVAL '14 days')::text), 'Auto-promote to live after this date if no kill switch')
ON CONFLICT (key) DO NOTHING;

-- optimizer_decisions: full audit trail of every change considered or executed
CREATE TABLE IF NOT EXISTS optimizer_decisions (
  id BIGSERIAL PRIMARY KEY,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mode TEXT NOT NULL CHECK (mode IN ('shadow', 'live')),
  metric_name TEXT NOT NULL,
  metric_value NUMERIC,
  sample_size INTEGER,
  parameter_changed TEXT,
  old_value JSONB,
  new_value JSONB,
  reasoning TEXT NOT NULL,
  reversal_condition TEXT,
  executed BOOLEAN NOT NULL DEFAULT FALSE,
  reverted_at TIMESTAMPTZ,
  revert_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_optimizer_decisions_decided_at ON optimizer_decisions(decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_optimizer_decisions_executed ON optimizer_decisions(executed, decided_at DESC);

-- optimizer_funnel_snapshots: time series of pipeline health
CREATE TABLE IF NOT EXISTS optimizer_funnel_snapshots (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_days INTEGER NOT NULL DEFAULT 7,
  leads_ingested INTEGER,
  leads_enriched INTEGER,
  leads_fit_scored INTEGER,
  leads_high_fit INTEGER,
  leads_ready INTEGER,
  leads_dm_drafted INTEGER,
  dms_sent INTEGER,
  connections_accepted INTEGER,
  replies_received INTEGER,
  conversions INTEGER,
  accept_rate NUMERIC,
  reply_rate NUMERIC,
  per_cohort_stats JSONB,
  per_opener_stats JSONB
);

CREATE INDEX IF NOT EXISTS idx_funnel_snapshots_captured_at ON optimizer_funnel_snapshots(captured_at DESC);

-- Helper: read a config value with fallback
CREATE OR REPLACE FUNCTION get_optimizer_config(p_key TEXT, p_default JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_value JSONB;
BEGIN
  SELECT value INTO v_value FROM optimizer_config WHERE key = p_key;
  RETURN COALESCE(v_value, p_default);
END;
$$;

-- Helper: capture funnel snapshot
CREATE OR REPLACE FUNCTION capture_funnel_snapshot(p_window_days INTEGER DEFAULT 7)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_snapshot_id BIGINT;
  v_cutoff TIMESTAMPTZ := NOW() - (p_window_days || ' days')::INTERVAL;
BEGIN
  INSERT INTO optimizer_funnel_snapshots (
    window_days,
    leads_ingested,
    leads_enriched,
    leads_fit_scored,
    leads_high_fit,
    leads_ready,
    leads_dm_drafted,
    dms_sent,
    connections_accepted,
    replies_received,
    conversions,
    accept_rate,
    reply_rate,
    per_cohort_stats,
    per_opener_stats
  )
  SELECT
    p_window_days,
    COUNT(*),
    COUNT(*) FILTER (WHERE enriched_at IS NOT NULL),
    COUNT(*) FILTER (WHERE fit_scored_at IS NOT NULL),
    COUNT(*) FILTER (WHERE fit_score >= (get_optimizer_config('fit_score_threshold', '70'::jsonb))::text::numeric),
    COUNT(*) FILTER (WHERE readiness_status = 'ready'),
    COUNT(*) FILTER (WHERE dm_drafted_at IS NOT NULL),
    COUNT(*) FILTER (WHERE dm_first_message_sent_at IS NOT NULL),
    COUNT(*) FILTER (WHERE dm_connection_accepted_at IS NOT NULL),
    COUNT(*) FILTER (WHERE dm_replied_at IS NOT NULL),
    COUNT(*) FILTER (WHERE is_paying_customer = true),
    CASE WHEN COUNT(*) FILTER (WHERE dm_connection_request_sent_at IS NOT NULL) > 0
         THEN (COUNT(*) FILTER (WHERE dm_connection_accepted_at IS NOT NULL))::NUMERIC
              / NULLIF(COUNT(*) FILTER (WHERE dm_connection_request_sent_at IS NOT NULL), 0)
         ELSE NULL END,
    CASE WHEN COUNT(*) FILTER (WHERE dm_first_message_sent_at IS NOT NULL) > 0
         THEN (COUNT(*) FILTER (WHERE dm_replied_at IS NOT NULL))::NUMERIC
              / NULLIF(COUNT(*) FILTER (WHERE dm_first_message_sent_at IS NOT NULL), 0)
         ELSE NULL END,
    (
      SELECT jsonb_object_agg(
        COALESCE(cohort_label, 'unknown'),
        jsonb_build_object(
          'leads', cnt,
          'sent', sent,
          'accepted', accepted,
          'replied', replied,
          'accept_rate', CASE WHEN sent > 0 THEN ROUND(accepted::NUMERIC / sent, 3) ELSE NULL END
        )
      )
      FROM (
        SELECT
          cohort_label,
          COUNT(*) AS cnt,
          COUNT(*) FILTER (WHERE dm_connection_request_sent_at IS NOT NULL) AS sent,
          COUNT(*) FILTER (WHERE dm_connection_accepted_at IS NOT NULL) AS accepted,
          COUNT(*) FILTER (WHERE dm_replied_at IS NOT NULL) AS replied
        FROM warm_outbound_staging
        WHERE created_at >= v_cutoff
        GROUP BY cohort_label
      ) c
    ),
    '{}'::jsonb
  FROM warm_outbound_staging
  WHERE created_at >= v_cutoff
  RETURNING id INTO v_snapshot_id;

  RETURN v_snapshot_id;
END;
$$;

COMMENT ON TABLE optimizer_decisions IS 'MAPE-K: audit trail. Every parameter change (proposed or executed) recorded with reasoning.';
COMMENT ON TABLE optimizer_funnel_snapshots IS 'MAPE-K: time-series snapshot of pipeline health for trend analysis.';