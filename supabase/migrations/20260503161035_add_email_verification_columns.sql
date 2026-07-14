-- Track Hunter email verification before send
ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS email_verification_status TEXT,
  ADD COLUMN IF NOT EXISTS email_verification_score INT,
  ADD COLUMN IF NOT EXISTS email_verification_result JSONB,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_warm_outbound_email_verification
  ON warm_outbound_staging(email_verification_status)
  WHERE email_verification_status IS NOT NULL;

COMMENT ON COLUMN warm_outbound_staging.email_verification_status IS
  'Hunter /v2/email-verifier result: deliverable | undeliverable | risky | unknown';
COMMENT ON COLUMN warm_outbound_staging.email_verification_score IS
  'Hunter score 0-100. Below 50 = risky, below 30 = block.';