
ALTER TABLE partner_applications
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_partner_applications_referral_code ON partner_applications(referral_code);
CREATE INDEX IF NOT EXISTS idx_partner_applications_status ON partner_applications(status);
