-- PIPELINE WATCHDOG FOUNDATION
-- Permanent table to track pipeline health incidents and auto-remediation history.
-- Replaces the pattern of discovering the same failures every session.

CREATE TABLE IF NOT EXISTS pipeline_health_log (
  id               BIGSERIAL PRIMARY KEY,
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  check_name       TEXT NOT NULL,
  severity         TEXT NOT NULL CHECK (severity IN ('critical','warning','info')),
  affected_count   INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL CHECK (status IN ('healthy','degraded','remediated','manual_required')),
  detail           JSONB,
  remediation_sql  TEXT,
  remediated_at    TIMESTAMPTZ,
  remediated_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_pipeline_health_log_checked_at ON pipeline_health_log(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_health_log_severity   ON pipeline_health_log(severity, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_health_log_status     ON pipeline_health_log(status, checked_at DESC);

-- Allow service role full access
ALTER TABLE pipeline_health_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY pipeline_health_log_service_role ON pipeline_health_log
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- View: latest status per check (current health dashboard)
CREATE OR REPLACE VIEW pipeline_health_current AS
SELECT DISTINCT ON (check_name)
  check_name, severity, affected_count, status, detail, checked_at, remediated_at, remediated_count
FROM pipeline_health_log
ORDER BY check_name, checked_at DESC;

COMMENT ON TABLE pipeline_health_log IS
  'Permanent pipeline health audit trail. Populated hourly by pipeline-watchdog edge function. Never truncate — history is the point.';
