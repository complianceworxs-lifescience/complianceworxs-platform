
CREATE TABLE IF NOT EXISTS generated_ddrs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ddr_id          UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  decision_type   TEXT NOT NULL,
  sections_full   JSONB NOT NULL,
  paid            BOOLEAN DEFAULT FALSE NOT NULL,
  stripe_session_id TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  paid_at         TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '48 hours') NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_ddrs_ddr_id
  ON generated_ddrs(ddr_id);

CREATE INDEX IF NOT EXISTS idx_generated_ddrs_stripe_session
  ON generated_ddrs(stripe_session_id);

CREATE INDEX IF NOT EXISTS idx_generated_ddrs_expires
  ON generated_ddrs(expires_at);

ALTER TABLE generated_ddrs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No public access" ON generated_ddrs
  FOR ALL USING (false);
