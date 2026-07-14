ALTER TABLE warm_outbound_staging
  DROP CONSTRAINT IF EXISTS warm_outbound_staging_company_research_status_check;

ALTER TABLE warm_outbound_staging
  ADD CONSTRAINT warm_outbound_staging_company_research_status_check
  CHECK (company_research_status IN ('pending', 'researched', 'skipped', 'error', 'disqualified'));

ALTER TABLE companies_research
  ADD COLUMN IF NOT EXISTS is_fda_regulated boolean;