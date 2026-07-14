-- ================================================================
-- ML INTELLIGENCE LAYER
-- Three components:
-- 1. outbound_events        — real-time sensor stream (every transaction)
-- 2. outbound_ab_variants   — variant registry for A/B test management
-- 3. outbound_ab_results    — statistical results per variant per window
-- 4. outbound_rl_state      — reinforcement learning objective + reward state
-- 5. outbound_segment_stats — clustering output: per-segment performance
-- ================================================================

-- 1. SENSOR STREAM — every transaction logged here automatically
CREATE TABLE IF NOT EXISTS outbound_events (
  id            BIGSERIAL PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lead_id       BIGINT REFERENCES warm_outbound_staging(id),
  event_type    TEXT NOT NULL, 
  -- event_type values:
  -- ingested | enriched | scored | readiness_checked | readiness_failed
  -- dm_drafted | connection_sent | connection_accepted | connection_rejected
  -- message_sent | reply_received | positive_reply | negative_reply | unsubscribe
  -- email_sent | email_bounced | email_opened | email_replied | nurture_enrolled
  properties    JSONB NOT NULL DEFAULT '{}',
  -- properties: fit_score, cohort_label, role_function, industry, 
  --             variant_id, opener_type, message_char_count,
  --             linkedin_description_length, company_size, etc.
  session_id    TEXT  -- groups events within one automation run
);

CREATE INDEX IF NOT EXISTS idx_outbound_events_occurred_at ON outbound_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_events_event_type  ON outbound_events(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_events_lead_id     ON outbound_events(lead_id);

-- 2. A/B VARIANT REGISTRY
CREATE TABLE IF NOT EXISTS outbound_ab_variants (
  id              SERIAL PRIMARY KEY,
  variant_key     TEXT NOT NULL UNIQUE,  -- e.g. 'opener_inspector_question_v1'
  variant_type    TEXT NOT NULL,         -- 'dm_opener' | 'email_subject' | 'email_body' | 'connection_note'
  description     TEXT NOT NULL,
  template        TEXT NOT NULL,         -- the actual template text / prompt fragment
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_control      BOOLEAN NOT NULL DEFAULT FALSE,
  traffic_weight  NUMERIC NOT NULL DEFAULT 1.0,  -- relative weight for traffic split
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at      TIMESTAMPTZ,
  retire_reason   TEXT
);

-- Seed initial DM opener variants from what we know about current message patterns
INSERT INTO outbound_ab_variants (variant_key, variant_type, description, template, is_control, traffic_weight) VALUES
(
  'opener_inspector_question_v1',
  'dm_opener',
  'Control: opens with inspector asking who authorized decision. Current default.',
  'When an FDA inspector asks who authorized {decision_type} and why, can your team reconstruct that record today?',
  TRUE,
  1.0
),
(
  'opener_exposure_moment_v1', 
  'dm_opener',
  'Challenger A: opens with specific inspection failure moment before the question.',
  'Six weeks before a PAI, {first_name}. That''s usually when QA teams realize the decision trail for {decision_type} isn''t as clean as the SOP suggests.',
  FALSE,
  1.0
),
(
  'opener_warning_letter_v1',
  'dm_opener', 
  'Challenger B: opens with warning letter signal — for leads at companies with recent 483s.',
  '{first_name}, the 483 observation pattern on authorization documentation is consistent. The gap isn''t the decision itself — it''s the record behind it.',
  FALSE,
  1.0
)
ON CONFLICT (variant_key) DO NOTHING;

-- 3. A/B STATISTICAL RESULTS — updated daily by optimizer
CREATE TABLE IF NOT EXISTS outbound_ab_results (
  id              BIGSERIAL PRIMARY KEY,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  variant_id      INTEGER REFERENCES outbound_ab_variants(id),
  window_days     INTEGER NOT NULL DEFAULT 14,
  sends           INTEGER NOT NULL DEFAULT 0,
  accepts         INTEGER NOT NULL DEFAULT 0,
  replies         INTEGER NOT NULL DEFAULT 0,
  positive_replies INTEGER NOT NULL DEFAULT 0,
  accept_rate     NUMERIC,
  reply_rate      NUMERIC,
  positive_reply_rate NUMERIC,
  z_score         NUMERIC,    -- vs control
  p_value         NUMERIC,    -- statistical significance
  is_significant  BOOLEAN NOT NULL DEFAULT FALSE,
  recommendation  TEXT        -- 'promote' | 'pause' | 'continue_testing' | 'insufficient_data'
);

CREATE INDEX IF NOT EXISTS idx_ab_results_computed_at ON outbound_ab_results(computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ab_results_variant_id  ON outbound_ab_results(variant_id, computed_at DESC);

-- 4. REINFORCEMENT LEARNING STATE
-- Tracks the objective function and current reward signal
CREATE TABLE IF NOT EXISTS outbound_rl_state (
  id                    BIGSERIAL PRIMARY KEY,
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Objective function parameters (what we're optimizing for)
  objective_primary     TEXT NOT NULL DEFAULT 'maximize_positive_reply_rate',
  objective_constraint  TEXT NOT NULL DEFAULT 'unsubscribe_rate < 0.02',
  -- Current state vector (snapshot of system state)
  fit_score_threshold   NUMERIC NOT NULL,
  daily_dm_budget       NUMERIC NOT NULL,
  active_variant_key    TEXT NOT NULL,
  active_cohorts        JSONB NOT NULL DEFAULT '[]',
  -- Reward signal (did the last action improve the objective?)
  reward_signal         NUMERIC,   -- positive = good, negative = bad
  reward_components     JSONB,     -- breakdown: accept_rate_delta, reply_rate_delta, unsubscribe_penalty
  -- Action taken
  action_taken          TEXT,      -- what the RL agent did this step
  action_parameters     JSONB,     -- parameters of the action
  -- Outcome (filled in on next cycle)
  outcome_measured_at   TIMESTAMPTZ,
  outcome_accept_rate   NUMERIC,
  outcome_reply_rate    NUMERIC,
  outcome_positive_reply_rate NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_rl_state_recorded_at ON outbound_rl_state(recorded_at DESC);

-- 5. SEGMENT CLUSTERING STATS — output of daily clustering analysis
CREATE TABLE IF NOT EXISTS outbound_segment_stats (
  id              BIGSERIAL PRIMARY KEY,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  segment_type    TEXT NOT NULL,   -- 'cohort' | 'role_function' | 'industry' | 'fit_score_band' | 'company_size_band'
  segment_value   TEXT NOT NULL,   -- the actual value, e.g. 'qa' or '501-1000'
  window_days     INTEGER NOT NULL DEFAULT 14,
  total_leads     INTEGER NOT NULL DEFAULT 0,
  sent            INTEGER NOT NULL DEFAULT 0,
  accepted        INTEGER NOT NULL DEFAULT 0,
  replied         INTEGER NOT NULL DEFAULT 0,
  positive_replied INTEGER NOT NULL DEFAULT 0,
  accept_rate     NUMERIC,
  reply_rate      NUMERIC,
  avg_fit_score   NUMERIC,
  -- Anomaly flags
  is_underperforming BOOLEAN NOT NULL DEFAULT FALSE,
  is_overperforming  BOOLEAN NOT NULL DEFAULT FALSE,
  anomaly_note    TEXT,
  -- Regression coefficient (how much this segment predicts positive reply)
  regression_coeff NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_segment_stats_computed_at ON outbound_segment_stats(computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_segment_stats_type_value  ON outbound_segment_stats(segment_type, segment_value);

-- ================================================================
-- TRIGGER: auto-fire sensor events from warm_outbound_staging changes
-- ================================================================

CREATE OR REPLACE FUNCTION trigger_outbound_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_event_type TEXT;
  v_props JSONB;
BEGIN
  -- Detect which field changed and emit the right event
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'ingested';
  ELSIF NEW.enriched_at IS NOT NULL AND (OLD.enriched_at IS NULL) THEN
    v_event_type := 'enriched';
  ELSIF NEW.fit_scored_at IS NOT NULL AND (OLD.fit_scored_at IS NULL) THEN
    v_event_type := 'scored';
  ELSIF NEW.dm_drafted_at IS NOT NULL AND (OLD.dm_drafted_at IS NULL) THEN
    v_event_type := 'dm_drafted';
  ELSIF NEW.dm_connection_request_sent_at IS NOT NULL AND (OLD.dm_connection_request_sent_at IS NULL) THEN
    v_event_type := 'connection_sent';
  ELSIF NEW.dm_connection_accepted_at IS NOT NULL AND (OLD.dm_connection_accepted_at IS NULL) THEN
    v_event_type := 'connection_accepted';
  ELSIF NEW.dm_first_message_sent_at IS NOT NULL AND (OLD.dm_first_message_sent_at IS NULL) THEN
    v_event_type := 'message_sent';
  ELSIF NEW.dm_replied_at IS NOT NULL AND (OLD.dm_replied_at IS NULL) THEN
    v_event_type := 'reply_received';
  ELSIF NEW.delivery_status = 'bounce' AND (OLD.delivery_status IS DISTINCT FROM 'bounce') THEN
    v_event_type := 'email_bounced';
  ELSIF NEW.delivery_status = 'sent' AND (OLD.delivery_status IS DISTINCT FROM 'sent') THEN
    v_event_type := 'email_sent';
  ELSIF NEW.replied_at IS NOT NULL AND (OLD.replied_at IS NULL) THEN
    v_event_type := 'email_replied';
  ELSE
    RETURN NEW; -- no tracked event
  END IF;

  -- Build properties snapshot at event time
  v_props := jsonb_build_object(
    'fit_score',                    NEW.fit_score,
    'cohort_label',                 NEW.cohort_label,
    'role_function',                NEW.role_function,
    'industry',                     NEW.linkedin_company_industry,
    'company_size',                 NEW.linkedin_company_employees_count,
    'linkedin_description_length',  length(COALESCE(NEW.linkedin_description, '')),
    'linkedin_headline_present',    (NEW.linkedin_headline IS NOT NULL),
    'has_email',                    (NEW.email IS NOT NULL),
    'readiness_status',             NEW.readiness_status,
    'dm_char_count',                length(COALESCE(NEW.dm_draft_body, '')),
    'source',                       NEW.source,
    'target_account_priority',      NEW.target_account_priority
  );

  INSERT INTO outbound_events (lead_id, event_type, properties)
  VALUES (NEW.id, v_event_type, v_props);

  RETURN NEW;
END;
$$;

-- Attach trigger to warm_outbound_staging
DROP TRIGGER IF EXISTS trg_outbound_events ON warm_outbound_staging;
CREATE TRIGGER trg_outbound_events
  AFTER INSERT OR UPDATE ON warm_outbound_staging
  FOR EACH ROW EXECUTE FUNCTION trigger_outbound_event();

-- ================================================================
-- RLS policies for new tables
-- ================================================================
ALTER TABLE outbound_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_ab_variants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_ab_results    ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_rl_state      ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_segment_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON outbound_events        FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON outbound_ab_variants   FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON outbound_ab_results    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON outbound_rl_state      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON outbound_segment_stats FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE outbound_events        IS 'MAPE-K Layer 1: Real-time sensor stream. Every outbound transaction fires here.';
COMMENT ON TABLE outbound_ab_variants   IS 'MAPE-K Layer 3: Variant registry for A/B test management.';
COMMENT ON TABLE outbound_ab_results    IS 'MAPE-K Layer 3: Statistical test results per variant.';
COMMENT ON TABLE outbound_rl_state      IS 'MAPE-K Layer 3: Reinforcement learning state + reward signal.';
COMMENT ON TABLE outbound_segment_stats IS 'MAPE-K Layer 2: Clustering output — per-segment performance anomaly detection.';