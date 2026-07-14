-- ============================================================
-- Helper views for MAPE-K optimizer
-- ============================================================

-- Per-cohort performance (rolling 14 days)
CREATE OR REPLACE VIEW v_cohort_performance AS
SELECT
  cohort_label,
  COUNT(*) FILTER (WHERE dm_connection_request_sent_at >= NOW() - INTERVAL '14 days') AS connections_sent_14d,
  COUNT(*) FILTER (WHERE dm_connection_accepted_at >= NOW() - INTERVAL '14 days') AS connections_accepted_14d,
  COUNT(*) FILTER (WHERE dm_first_message_sent_at >= NOW() - INTERVAL '14 days') AS first_msgs_sent_14d,
  COUNT(*) FILTER (WHERE dm_replied_at >= NOW() - INTERVAL '14 days') AS replies_14d,
  COUNT(*) FILTER (WHERE is_paying_customer = true AND dm_first_message_sent_at >= NOW() - INTERVAL '14 days') AS customers_14d,
  ROUND(
    COUNT(*) FILTER (WHERE dm_connection_accepted_at >= NOW() - INTERVAL '14 days')::numeric /
    NULLIF(COUNT(*) FILTER (WHERE dm_connection_request_sent_at >= NOW() - INTERVAL '14 days'), 0),
    4
  ) AS accept_rate_14d,
  ROUND(
    COUNT(*) FILTER (WHERE dm_replied_at >= NOW() - INTERVAL '14 days')::numeric /
    NULLIF(COUNT(*) FILTER (WHERE dm_first_message_sent_at >= NOW() - INTERVAL '14 days'), 0),
    4
  ) AS reply_rate_14d
FROM warm_outbound_staging
WHERE cohort_label IS NOT NULL
GROUP BY cohort_label;

-- Funnel health snapshot (rolling 14 days)
CREATE OR REPLACE VIEW v_funnel_health AS
SELECT
  COUNT(*) AS leads_total,
  COUNT(*) FILTER (WHERE enriched_at IS NOT NULL) AS enriched,
  COUNT(*) FILTER (WHERE fit_scored_at IS NOT NULL) AS fit_scored,
  COUNT(*) FILTER (WHERE fit_score >= (SELECT (value::text)::int FROM optimizer_config WHERE key = 'fit_score_threshold')) AS high_fit,
  COUNT(*) FILTER (WHERE fit_score >= (SELECT (value::text)::int FROM optimizer_config WHERE key = 'fit_score_threshold') AND readiness_status = 'ready') AS ready,
  COUNT(*) FILTER (WHERE dm_drafted_at IS NOT NULL) AS dm_drafted,
  COUNT(*) FILTER (WHERE dm_connection_request_sent_at IS NOT NULL) AS connection_sent,
  COUNT(*) FILTER (WHERE dm_connection_accepted_at IS NOT NULL) AS connection_accepted,
  COUNT(*) FILTER (WHERE dm_replied_at IS NOT NULL) AS replied,
  COUNT(*) FILTER (WHERE is_paying_customer = true) AS paid,
  COUNT(*) FILTER (WHERE fit_score >= (SELECT (value::text)::int FROM optimizer_config WHERE key = 'fit_score_threshold') AND readiness_status IS NULL AND archived_at IS NULL) AS stranded_high_fit
FROM warm_outbound_staging
WHERE created_at >= NOW() - INTERVAL '14 days';

-- ============================================================
-- BUG FIX: Readiness trigger only fired on INSERT, never on UPDATE
-- This is why 146 high-fit leads were stranded.
-- ============================================================

-- Trigger function that also fires when fit_score crosses threshold
CREATE OR REPLACE FUNCTION trg_auto_evaluate_readiness_on_score()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Fire readiness eval when fit_score becomes high enough AND readiness was never checked
  IF NEW.fit_score IS NOT NULL
     AND NEW.fit_score >= (SELECT (value::text)::int FROM optimizer_config WHERE key = 'fit_score_threshold')
     AND NEW.readiness_status IS NULL
     AND NEW.archived_at IS NULL
     AND (OLD.fit_score IS DISTINCT FROM NEW.fit_score OR OLD.readiness_status IS DISTINCT FROM NEW.readiness_status) THEN
    PERFORM evaluate_lead_readiness(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS warm_outbound_auto_readiness_on_score ON warm_outbound_staging;
CREATE TRIGGER warm_outbound_auto_readiness_on_score
  AFTER UPDATE ON warm_outbound_staging
  FOR EACH ROW
  EXECUTE FUNCTION trg_auto_evaluate_readiness_on_score();