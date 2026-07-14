CREATE TABLE IF NOT EXISTS companies_research (
  domain text PRIMARY KEY,
  company_name text,
  recent_fda_signals text,
  recent_product_events text,
  leadership_changes text,
  open_quality_roles text,
  inspector_angle text,
  raw_response jsonb,
  researched_at timestamptz DEFAULT now(),
  research_error text
);

CREATE INDEX IF NOT EXISTS idx_companies_research_researched_at ON companies_research(researched_at DESC);

-- Add company_research_status to staging for tracking
ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS company_research_status text DEFAULT 'pending'
    CHECK (company_research_status IN ('pending', 'researched', 'skipped', 'error'));