-- View: PB failure state — leads stuck with phantom error flags
-- Populated by watchdog check, also queryable directly at session start

CREATE OR REPLACE VIEW v_pb_failures AS
SELECT
  outbound_action,
  dm_status,
  COUNT(*) AS cnt,
  STRING_AGG(full_name || ' / ' || COALESCE(company, '?'), ', ' ORDER BY fit_score DESC NULLS LAST) AS affected_leads,
  CASE
    WHEN outbound_action = 'pb_agent_dead'        THEN 'Wrong agent ID — update PB_AUTO_CONNECT_AGENT in dm-dispatcher'
    WHEN outbound_action = 'pb_agent_busy_retry_tomorrow' THEN 'Transient — phantom was mid-run. Will retry next dispatch.'
    WHEN outbound_action LIKE 'pb_launch_error_%' THEN 'PB API error — check PB dashboard for phantom status'
    WHEN outbound_action = 'pb_exception'         THEN 'Network/timeout exception — transient, will retry'
    WHEN outbound_action = 'pb_key_missing_manual_required' THEN 'PHANTOMBUSTER_API_KEY env var missing from dm-dispatcher'
    ELSE 'Unknown PB failure state'
  END AS diagnosis
FROM warm_outbound_staging
WHERE outbound_action ILIKE 'pb_%'
  AND archived_at IS NULL
GROUP BY outbound_action, dm_status
ORDER BY cnt DESC;

COMMENT ON VIEW v_pb_failures IS
  'PhantomBuster failure states on warm_outbound_staging. Any row here means cold connect requests are blocked or misfired. Check at session start alongside v_pipeline_health_summary.';
