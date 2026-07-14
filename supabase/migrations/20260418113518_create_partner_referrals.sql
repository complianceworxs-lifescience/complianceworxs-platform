
CREATE TABLE IF NOT EXISTS partner_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  partner_code TEXT NOT NULL,
  partner_name TEXT NOT NULL,
  partner_email TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_company TEXT,
  client_email TEXT NOT NULL,
  client_title TEXT,
  introduction_date DATE NOT NULL,
  introduction_method TEXT,
  notes TEXT,
  status TEXT DEFAULT 'pending',
  verified BOOLEAN DEFAULT FALSE,
  stripe_customer_id TEXT,
  total_purchases_usd NUMERIC(10,2) DEFAULT 0,
  total_earnings_usd NUMERIC(10,2) DEFAULT 0,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_partner_referrals_partner_code ON partner_referrals(partner_code);
CREATE INDEX IF NOT EXISTS idx_partner_referrals_client_email ON partner_referrals(client_email);
CREATE INDEX IF NOT EXISTS idx_partner_referrals_status ON partner_referrals(status);
