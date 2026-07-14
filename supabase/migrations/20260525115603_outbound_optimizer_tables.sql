CREATE TABLE IF NOT EXISTS optimizer_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT 'init'
);

CREATE TABLE IF NOT EXISTS optimizer_decisions (
  id BIGSERIAL PRIMARY KEY,
  decision_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mode TEXT NOT NULL CHECK (mode IN ('shadow', 'live')),
  stage TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC,
  sample_size INTEGER,
  parameter_changed TEXT,
  old_value JSONB,
  new_value JSONB,
  reasoning TEXT NOT NULL,
  reversal_condition TEXT,
  applied BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS optimizer_metrics_snapshot (
  id BIGSERIAL PRIMARY KEY,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_days INTEGER NOT NULL DEFAULT 7,
  leads_ingested INTEGER,
  leads_enriched INTEGER,
  leads_scored INTEGER,
  leads_high_fit INTEGER,
  leads_drafted INTEGER,
  leads_sent INTEGER,
  leads_accepted INTEGER,
  leads_replied INTEGER,
  leads_paid INTEGER,
  enrich_rate NUMERIC,
  score_rate NUMERIC,
  high_fit_to_draft_rate NUMERIC,
  draft_to_send_rate NUMERIC,
  send_to_accept_rate NUMERIC,
  accept_to_reply_rate NUMERIC,
  reply_to_paid_rate NUMERIC,
  cohort_metrics JSONB,
  opener_metrics JSONB,
  worst_stage TEXT,
  worst_stage_rate NUMERIC
);