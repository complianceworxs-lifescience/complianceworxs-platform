
ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS report_email TEXT,
  ADD COLUMN IF NOT EXISTS weekly_digest_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS conversion_alerts_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS monthly_statement_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_weekly_digest_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_monthly_statement_at TIMESTAMPTZ;

-- Track which conversion alerts have already been sent (de-dupe)
ALTER TABLE partner_commissions
  ADD COLUMN IF NOT EXISTS alert_sent_at TIMESTAMPTZ;

-- Update Trevor with his report email
UPDATE partners
SET report_email = 'trevor@blackflagqc.com',
    contact_email = COALESCE(contact_email, 'trevor@blackflagqc.com')
WHERE partner_code = 'BFQC';

SELECT partner_code, partner_name, contact_full_name, report_email, weekly_digest_enabled
FROM partners WHERE partner_code = 'BFQC';
