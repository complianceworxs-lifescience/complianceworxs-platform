-- Health log: every daily check writes a row here. View shows latest.
CREATE TABLE IF NOT EXISTS system_health_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at timestamptz NOT NULL DEFAULT now(),
  overall_status text NOT NULL,                -- 'healthy', 'degraded', 'critical'
  checks jsonb NOT NULL,                       -- per-check pass/fail with details
  pipeline_snapshot jsonb,                     -- pipeline_summary at this moment
  alerts text[],                               -- list of issues to look at
  duration_ms integer
);

CREATE INDEX IF NOT EXISTS idx_health_log_checked_at ON system_health_log(checked_at DESC);

CREATE OR REPLACE VIEW system_health_latest AS
SELECT *
FROM system_health_log
ORDER BY checked_at DESC
LIMIT 1;