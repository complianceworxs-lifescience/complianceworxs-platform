-- Track delivery status for retry logic
ALTER TABLE exposure_snapshot_tokens
  ADD COLUMN IF NOT EXISTS email_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS email_attempts int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_last_error text,
  ADD COLUMN IF NOT EXISTS email_next_retry_at timestamptz;

-- Backfill: rows where email_sent_at is set are 'sent', otherwise 'pending'
UPDATE exposure_snapshot_tokens
SET email_status = CASE WHEN email_sent_at IS NOT NULL THEN 'sent' ELSE 'pending' END
WHERE email_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_exposure_email_retry 
  ON exposure_snapshot_tokens(email_status, email_next_retry_at)
  WHERE email_status IN ('pending', 'retry');