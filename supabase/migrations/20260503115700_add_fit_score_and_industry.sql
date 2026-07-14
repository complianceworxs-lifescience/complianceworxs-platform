ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS industry TEXT,                        -- pharma | med_device | biotech | cdmo | non_target
  ADD COLUMN IF NOT EXISTS industry_confidence NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS role_seniority TEXT,                  -- executive | director | manager | individual
  ADD COLUMN IF NOT EXISTS role_function TEXT,                   -- qa | regulatory | validation | manufacturing | other
  ADD COLUMN IF NOT EXISTS fit_score INTEGER,                    -- 0-100
  ADD COLUMN IF NOT EXISTS fit_score_breakdown JSONB,            -- {industry: 30, role: 25, company_size: 20, recency: 10, ...}
  ADD COLUMN IF NOT EXISTS fit_scored_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_staging_fit_score
  ON warm_outbound_staging (fit_score DESC NULLS LAST)
  WHERE enrichment_status = 'enriched' AND email IS NOT NULL AND dispatched_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_staging_industry ON warm_outbound_staging (industry);

-- Add disqualified_non_target as a valid status
COMMENT ON COLUMN warm_outbound_staging.enrichment_status IS 
  'pending | enriched | disqualified_not_fda_regulated | disqualified_non_target | failed_*';