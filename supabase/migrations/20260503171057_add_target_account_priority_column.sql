-- Add a tagging column for pre-qualified target-account cohorts.
-- When set, the cohort bypasses the standard fit_score >= 70 threshold
-- because the company-level qualification is already done.
ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS target_account_priority TEXT,
  ADD COLUMN IF NOT EXISTS target_account_tagged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_warm_outbound_staging_target_account
  ON warm_outbound_staging(target_account_priority)
  WHERE target_account_priority IS NOT NULL;

COMMENT ON COLUMN warm_outbound_staging.target_account_priority IS 
  'Tag for pre-qualified target-account cohorts (e.g., batch_release_cohort). '
  'When set, drafter bypasses standard fit_score gate.';