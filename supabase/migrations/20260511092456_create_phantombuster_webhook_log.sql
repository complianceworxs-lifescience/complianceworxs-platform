CREATE TABLE IF NOT EXISTS phantombuster_webhook_log (
  id BIGSERIAL PRIMARY KEY,
  agent_id TEXT,
  agent_name TEXT,
  container_id TEXT,
  script TEXT,
  exit_message TEXT,
  exit_code INTEGER,
  result_object JSONB,
  raw_payload JSONB,
  routed_to TEXT,
  rows_processed INTEGER DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pb_webhook_log_created_at ON phantombuster_webhook_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pb_webhook_log_agent_id ON phantombuster_webhook_log(agent_id);