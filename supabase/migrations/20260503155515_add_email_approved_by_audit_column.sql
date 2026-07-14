ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS email_approved_by TEXT;