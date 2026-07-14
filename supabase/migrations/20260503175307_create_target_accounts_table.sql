-- Master target-account universe for CW prospecting.
-- One row per company. Scaling target: ~1,000 rows.
-- Used by:
--  1. cohort tagger (matches incoming Phantombuster leads by company name)
--  2. drafter (selects the right industry hook based on best_fit_decision_record)
--  3. Excel/CSV exports for offline review
--  4. PostHog dashboards for cohort-level pipeline tracking
CREATE TABLE IF NOT EXISTS target_accounts (
  id BIGSERIAL PRIMARY KEY,
  company_name TEXT NOT NULL,
  company_name_normalized TEXT GENERATED ALWAYS AS (LOWER(REGEXP_REPLACE(company_name, '[^a-zA-Z0-9]', '', 'g'))) STORED,
  website TEXT,
  subsegment TEXT,
  headcount_band TEXT,
  us_presence TEXT,
  primary_site_state TEXT,
  secondary_site_state TEXT,
  public_status TEXT,
  ownership_type TEXT,
  business_model TEXT,
  manufacturing_type TEXT,
  product_type TEXT,
  regulated_activity TEXT,
  quality_function_presence TEXT,
  best_fit_decision_record TEXT,           -- Batch Release / CAPA / Deviation / Supplier / Complaint / Change Control / Data Integrity
  secondary_decision_record TEXT,
  likely_quality_pressure TEXT,
  inspection_signal TEXT,
  story_angle TEXT,
  priority_score INT,
  source_notes TEXT,
  last_verified_date DATE,
  -- Workflow / audit columns
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  added_to_attio_at TIMESTAMPTZ,           -- when (or if) we sync to Attio Companies
  attio_company_record_id TEXT,            -- if synced
  active BOOLEAN DEFAULT TRUE,             -- false = deprecated/wrong-fit
  CONSTRAINT target_accounts_unique_name UNIQUE (company_name_normalized)
);

CREATE INDEX IF NOT EXISTS idx_target_accounts_priority ON target_accounts(priority_score DESC) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_target_accounts_best_fit ON target_accounts(best_fit_decision_record) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_target_accounts_normalized ON target_accounts(company_name_normalized) WHERE active = TRUE;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_target_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_target_accounts_updated_at ON target_accounts;
CREATE TRIGGER trg_target_accounts_updated_at
  BEFORE UPDATE ON target_accounts
  FOR EACH ROW EXECUTE FUNCTION update_target_accounts_updated_at();

COMMENT ON TABLE target_accounts IS 
  'Master prospecting universe for CW. Companies scored by best-fit decision record. '
  'Drives cohort tagging on warm_outbound_staging and drafter routing.';