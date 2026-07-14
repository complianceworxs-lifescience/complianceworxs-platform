ALTER TABLE partner_applications
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_connect_onboarded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_partner_applications_stripe_connect
  ON partner_applications (stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL;

COMMENT ON COLUMN partner_applications.stripe_connect_account_id IS
  'Stripe Connect Express account ID. NULL until partner completes onboarding.';
COMMENT ON COLUMN partner_applications.stripe_connect_onboarded_at IS
  'Timestamp when Stripe webhook confirmed account.updated with charges_enabled=true.';