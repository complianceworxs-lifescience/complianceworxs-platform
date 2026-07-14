-- Track whether each lead has been promoted to Buyer Pipeline list
ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS buyer_pipeline_entry_id TEXT,
  ADD COLUMN IF NOT EXISTS buyer_pipeline_stage TEXT,
  ADD COLUMN IF NOT EXISTS buyer_pipeline_added_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_warm_outbound_staging_no_pipeline
ON warm_outbound_staging (enriched_at)
WHERE enrichment_status = 'enriched'
  AND email IS NOT NULL
  AND attio_record_id IS NOT NULL
  AND buyer_pipeline_entry_id IS NULL;