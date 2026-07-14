
-- CW drafter persona registry — full export of voice + sequences for SaaS migration
CREATE TABLE IF NOT EXISTS cw_drafter_persona_registry (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  content JSONB NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_drafter_persona_active 
  ON cw_drafter_persona_registry (scope, active) WHERE active = true;
