-- Tables for PB agent + container diagnostic dumps
CREATE TABLE IF NOT EXISTS pb_agent_inventory (
  agent_id TEXT PRIMARY KEY,
  agent_name TEXT,
  script TEXT,
  org TEXT,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  runs_7d INTEGER DEFAULT 0,
  successes_7d INTEGER DEFAULT 0,
  total_containers_seen INTEGER DEFAULT 0,
  raw_agent JSONB,
  snapshot_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pb_container_history (
  container_id TEXT PRIMARY KEY,
  agent_id TEXT,
  agent_name TEXT,
  launched_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  exit_code INTEGER,
  exit_message TEXT,
  runtime_ms BIGINT,
  snapshot_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pb_container_launched ON pb_container_history(launched_at DESC);
CREATE INDEX IF NOT EXISTS idx_pb_container_agent ON pb_container_history(agent_id, launched_at DESC);