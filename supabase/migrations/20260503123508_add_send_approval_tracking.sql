ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS email_approved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS send_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS send_error TEXT,
  ADD COLUMN IF NOT EXISTS send_provider TEXT,
  ADD COLUMN IF NOT EXISTS send_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_staging_pending_send
  ON warm_outbound_staging (email_approved_at)
  WHERE email_approved = TRUE
    AND dispatched_at IS NULL
    AND first_touch_draft_body IS NOT NULL;