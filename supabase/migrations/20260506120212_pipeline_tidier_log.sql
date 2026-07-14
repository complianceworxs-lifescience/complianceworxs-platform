CREATE TABLE IF NOT EXISTS pipeline_tidier_log (
  id BIGSERIAL PRIMARY KEY,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  results JSONB
);
CREATE INDEX IF NOT EXISTS idx_pipeline_tidier_log_ran_at ON pipeline_tidier_log(ran_at DESC);