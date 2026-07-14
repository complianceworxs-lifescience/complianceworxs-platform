CREATE TABLE IF NOT EXISTS decision_log (
  id BIGSERIAL PRIMARY KEY,
  source_slug TEXT NOT NULL,
  recommendation TEXT NOT NULL CHECK (recommendation IN ('KILL_high_bounce','KILL_low_icp','KILL_no_replies','SCALE','MEASURE','MEASURE_promising','OPTIMIZE','STAY')),
  rationale TEXT NOT NULL,
  metrics_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL','EXECUTED','REJECTED','EXPIRED')),
  human_verdict TEXT CHECK (human_verdict IN ('AGREE','DISAGREE','UNSURE')),
  human_notes TEXT,
  audited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- For uniqueness: one decision per source per day
  decision_date DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_log_source_date 
  ON decision_log(source_slug, decision_date);

CREATE INDEX IF NOT EXISTS idx_decision_log_status 
  ON decision_log(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_log_recent 
  ON decision_log(created_at DESC);

COMMENT ON TABLE decision_log IS 
  'Shadow Governor advisory log. Path C: Claude proposes KILL/SCALE; human audits. Flip status=EXECUTED when ready to autonomize.';
COMMENT ON COLUMN decision_log.human_verdict IS 
  'Calibration test: did Jon agree with Claude? Tracks gut-vs-classifier alignment over time.';