-- ============================================================
-- OUTBOUND OPTIMIZER: MAPE-K self-optimization loop
-- Monitor / Analyze / Plan / Execute, backed by config + log
-- ============================================================

-- 1. Live tunable parameters (every downstream function reads from here)
CREATE TABLE IF NOT EXISTS optimizer_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT 'manual',
  reasoning text
);

INSERT INTO optimizer_config (key, value, updated_by, reasoning) VALUES
  ('optimizer_enabled',          'true'::jsonb,                                  'init', 'Master kill switch'),
  ('optimizer_mode',              '"shadow"'::jsonb,                             'init', 'shadow|live - shadow proposes, live executes'),
  ('shadow_mode_until',          to_jsonb((now() + interval '14 days')::text),   'init', 'Auto-flip to live after 14 days of decision_log data'),
  ('fit_score_threshold',         '70'::jsonb,                                   'init', 'Minimum fit_score for outbound progression'),
  ('daily_dm_budget',             '10'::jsonb,                                   'init', 'Max DMs sent per day'),
  ('default_opener_template',     '"authorization_logic_v1"'::jsonb,             'init', 'Active first-touch DM opener'),
  ('paused_cohorts',              '[]'::jsonb,                                   'init', 'Cohort labels currently excluded from outbound'),
  ('min_cohort_sample_size',      '30'::jsonb,                                   'init', 'Minimum sends before cohort gets judged'),
  ('min_cohort_accept_rate',      '0.10'::jsonb,                                 'init', 'Below this, cohort gets paused'),
  ('max_threshold_step',          '5'::jsonb,                                    'init', 'Max fit_score points moved per day'),
  ('max_budget_step_pct',         '0.20'::jsonb,                                 'init', 'Max % budget change per day'),
  ('healthy_accept_rate',         '0.25'::jsonb,                                 'init', 'Target accept rate - below, scale down'),
  ('healthy_reply_rate',          '0.15'::jsonb,                                 'init', 'Target reply rate on accepted')
ON CONFLICT (key) DO NOTHING;

-- 2. Decision audit log (every change recorded, reversible)
CREATE TABLE IF NOT EXISTS optimizer_decisions (
  id bigserial PRIMARY KEY,
  decided_at timestamptz NOT NULL DEFAULT now(),
  mode text NOT NULL,                         -- 'shadow' or 'live'
  stage text NOT NULL,                        -- monitor|analyze|plan|execute
  metric_name text,
  metric_value numeric,
  sample_size integer,
  parameter_changed text,
  old_value jsonb,
  new_value jsonb,
  reasoning text NOT NULL,
  reversal_trigger text,
  executed boolean NOT NULL DEFAULT false,
  reverted_at timestamptz,
  reverted_reason text
);

CREATE INDEX IF NOT EXISTS idx_optimizer_decisions_decided_at ON optimizer_decisions (decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_optimizer_decisions_parameter ON optimizer_decisions (parameter_changed, decided_at DESC);

-- 3. Helper: read a config value
CREATE OR REPLACE FUNCTION get_optimizer_config(p_key text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT value FROM optimizer_config WHERE key = p_key;
$$;

-- 4. Helper: safely update a config value with audit
CREATE OR REPLACE FUNCTION set_optimizer_config(
  p_key text,
  p_new_value jsonb,
  p_reasoning text,
  p_reversal_trigger text DEFAULT NULL,
  p_executed boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_old jsonb;
  v_mode text;
BEGIN
  SELECT value INTO v_old FROM optimizer_config WHERE key = p_key;
  v_mode := (SELECT value::text FROM optimizer_config WHERE key = 'optimizer_mode');

  INSERT INTO optimizer_decisions (
    mode, stage, parameter_changed, old_value, new_value,
    reasoning, reversal_trigger, executed
  ) VALUES (
    REPLACE(v_mode, '"', ''), 'execute', p_key, v_old, p_new_value,
    p_reasoning, p_reversal_trigger, p_executed
  );

  IF p_executed THEN
    UPDATE optimizer_config
       SET value = p_new_value,
           updated_at = now(),
           updated_by = 'outbound-optimizer',
           reasoning = p_reasoning
     WHERE key = p_key;
  END IF;
END;
$$;

-- 5. PERMANENT FIX: rescrape view now catches NULL readiness_status too
DROP VIEW IF EXISTS v_leads_pending_rescrape;
CREATE VIEW v_leads_pending_rescrape AS
SELECT *
FROM warm_outbound_staging
WHERE archived_at IS NULL
  AND automation_paused IS NOT TRUE
  AND linkedin_url IS NOT NULL
  AND (
    -- Original: explicit retry window elapsed
    (readiness_status = 'pending_retry' AND readiness_retry_due_at <= now())
    OR
    -- NEW: high-fit leads that never got LinkedIn-scraped
    (fit_score >= (SELECT (value)::int FROM optimizer_config WHERE key = 'fit_score_threshold')
     AND linkedin_scraped_at IS NULL
     AND created_at < now() - interval '1 hour'
     AND (readiness_attempts IS NULL OR readiness_attempts < 3))
  );

-- 6. Monitor view: pipeline funnel last 7 days
CREATE OR REPLACE VIEW v_optimizer_funnel_7d AS
SELECT
  COUNT(*)::int AS leads_ingested,
  COUNT(*) FILTER (WHERE enriched_at IS NOT NULL)::int AS enriched,
  COUNT(*) FILTER (WHERE fit_scored_at IS NOT NULL)::int AS fit_scored,
  COUNT(*) FILTER (WHERE fit_score >= (SELECT (value)::int FROM optimizer_config WHERE key='fit_score_threshold'))::int AS high_fit,
  COUNT(*) FILTER (WHERE linkedin_scraped_at IS NOT NULL)::int AS linkedin_scraped,
  COUNT(*) FILTER (WHERE dm_drafted_at IS NOT NULL)::int AS dm_drafted,
  COUNT(*) FILTER (WHERE dm_connection_request_sent_at IS NOT NULL)::int AS connection_sent,
  COUNT(*) FILTER (WHERE dm_connection_accepted_at IS NOT NULL)::int AS connection_accepted,
  COUNT(*) FILTER (WHERE dm_first_message_sent_at IS NOT NULL)::int AS first_msg_sent,
  COUNT(*) FILTER (WHERE dm_replied_at IS NOT NULL)::int AS replied,
  COUNT(*) FILTER (WHERE is_paying_customer = true)::int AS paid
FROM warm_outbound_staging
WHERE created_at >= now() - interval '7 days';

-- 7. Monitor view: per-cohort performance last 14 days
CREATE OR REPLACE VIEW v_optimizer_cohort_performance_14d AS
SELECT
  COALESCE(cohort_label, 'unlabeled') AS cohort_label,
  COUNT(*)::int AS leads,
  COUNT(*) FILTER (WHERE dm_connection_request_sent_at IS NOT NULL)::int AS sent,
  COUNT(*) FILTER (WHERE dm_connection_accepted_at IS NOT NULL)::int AS accepted,
  COUNT(*) FILTER (WHERE dm_replied_at IS NOT NULL)::int AS replied,
  COUNT(*) FILTER (WHERE is_paying_customer = true)::int AS paid,
  ROUND(
    COUNT(*) FILTER (WHERE dm_connection_accepted_at IS NOT NULL)::numeric
    / NULLIF(COUNT(*) FILTER (WHERE dm_connection_request_sent_at IS NOT NULL), 0),
    4
  ) AS accept_rate,
  ROUND(
    COUNT(*) FILTER (WHERE dm_replied_at IS NOT NULL)::numeric
    / NULLIF(COUNT(*) FILTER (WHERE dm_connection_accepted_at IS NOT NULL), 0),
    4
  ) AS reply_rate
FROM warm_outbound_staging
WHERE created_at >= now() - interval '14 days'
GROUP BY 1
ORDER BY sent DESC NULLS LAST;

-- 8. Monitor view: silent leaks (leads stranded between stages)
CREATE OR REPLACE VIEW v_optimizer_silent_leaks AS
SELECT
  'high_fit_never_scraped' AS leak_type,
  COUNT(*)::int AS count
FROM warm_outbound_staging
WHERE created_at >= now() - interval '30 days'
  AND fit_score >= (SELECT (value)::int FROM optimizer_config WHERE key='fit_score_threshold')
  AND linkedin_scraped_at IS NULL
  AND archived_at IS NULL
  AND automation_paused IS NOT TRUE
UNION ALL
SELECT
  'enriched_never_scored',
  COUNT(*)::int
FROM warm_outbound_staging
WHERE created_at >= now() - interval '30 days'
  AND enriched_at IS NOT NULL
  AND fit_scored_at IS NULL
  AND archived_at IS NULL
UNION ALL
SELECT
  'accepted_no_first_message',
  COUNT(*)::int
FROM warm_outbound_staging
WHERE dm_connection_accepted_at IS NOT NULL
  AND dm_first_message_sent_at IS NULL
  AND archived_at IS NULL
UNION ALL
SELECT
  'replied_no_followup_task',
  COUNT(*)::int
FROM warm_outbound_staging
WHERE dm_replied_at IS NOT NULL
  AND next_followup_due_at IS NULL
  AND followup_completed_at IS NULL
  AND archived_at IS NULL;