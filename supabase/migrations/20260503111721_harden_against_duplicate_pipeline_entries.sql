-- LOCK 1: Database-level uniqueness on email in warm_outbound_staging.
-- Prevents Phantombuster from scraping the same person twice into staging.
-- Allows multiple null emails (lead exists but not yet enriched).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_warm_staging_email
ON warm_outbound_staging (LOWER(email))
WHERE email IS NOT NULL;

-- LOCK 2: Database-level uniqueness on attio_record_id once promoted.
-- Prevents two staging rows pointing at the same Attio person from creating two pipeline entries.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_warm_staging_promoted_attio
ON warm_outbound_staging (attio_record_id)
WHERE buyer_pipeline_entry_id IS NOT NULL;

-- LOCK 3: Audit table to track every promotion attempt for duplicate forensics
CREATE TABLE IF NOT EXISTS pipeline_promotion_audit (
  id BIGSERIAL PRIMARY KEY,
  staging_id BIGINT,
  attio_record_id TEXT,
  email TEXT,
  attempted_at TIMESTAMPTZ DEFAULT NOW(),
  result TEXT,           -- 'promoted', 'skipped_existing', 'failed', 'rate_limited'
  entry_id TEXT,
  http_status INTEGER,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_promotion_audit_email ON pipeline_promotion_audit (email);
CREATE INDEX IF NOT EXISTS idx_promotion_audit_attio ON pipeline_promotion_audit (attio_record_id);
CREATE INDEX IF NOT EXISTS idx_promotion_audit_time ON pipeline_promotion_audit (attempted_at DESC);