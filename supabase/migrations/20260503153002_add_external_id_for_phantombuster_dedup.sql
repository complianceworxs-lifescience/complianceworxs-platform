-- Add external_id for Phantombuster dedup. LinkedIn URL is the natural key.
ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS phantombuster_container_id TEXT,
  ADD COLUMN IF NOT EXISTS ingest_payload JSONB;

-- Unique index on linkedin_url so the ingest is idempotent (same profile won't be inserted twice)
CREATE UNIQUE INDEX IF NOT EXISTS warm_outbound_staging_linkedin_url_uniq
  ON warm_outbound_staging (LOWER(linkedin_url))
  WHERE linkedin_url IS NOT NULL;