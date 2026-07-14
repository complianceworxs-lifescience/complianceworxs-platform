-- Stripe Connect was abandoned in favor of PayPal payouts.
-- Removing the columns added earlier today and adding a PayPal column instead.

DROP INDEX IF EXISTS idx_partner_applications_stripe_connect;

ALTER TABLE partner_applications
  DROP COLUMN IF EXISTS stripe_connect_account_id,
  DROP COLUMN IF EXISTS stripe_connect_onboarded_at;

ALTER TABLE partner_applications
  ADD COLUMN IF NOT EXISTS paypal_email text,
  ADD COLUMN IF NOT EXISTS paypal_email_confirmed_at timestamptz;

COMMENT ON COLUMN partner_applications.paypal_email IS
  'PayPal email address where partner commissions are sent. Provided by partner via email reply after approval.';
COMMENT ON COLUMN partner_applications.paypal_email_confirmed_at IS
  'Timestamp when PayPal email was confirmed (either by test payment or partner explicit confirmation).';