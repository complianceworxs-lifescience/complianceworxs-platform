-- Add lifecycle tracking columns to warm_outbound_staging
ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS last_attio_status text,
  ADD COLUMN IF NOT EXISTS replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS automation_paused boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS automation_paused_reason text,
  ADD COLUMN IF NOT EXISTS sequence_email_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sequence_email_at timestamptz,
  ADD COLUMN IF NOT EXISTS nurture_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archive_reason text;

-- Index for the daily-brief queries
CREATE INDEX IF NOT EXISTS idx_warm_outbound_staging_replied_at
  ON warm_outbound_staging (replied_at) WHERE replied_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warm_outbound_staging_archived_at
  ON warm_outbound_staging (archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_warm_outbound_staging_dispatched
  ON warm_outbound_staging (dispatched_at) WHERE dispatched_at IS NOT NULL;