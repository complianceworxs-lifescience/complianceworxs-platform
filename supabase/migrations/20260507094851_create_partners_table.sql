CREATE TABLE IF NOT EXISTS partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_code text UNIQUE NOT NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  company text,
  company_url text,
  linkedin_url text,
  primary_market text,
  status text DEFAULT 'active',
  attio_record_id text,
  attio_company_record_id text,
  stripe_connect_account_id text,
  notes text,
  approved_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partners_code ON partners(partner_code);
CREATE INDEX IF NOT EXISTS idx_partners_email ON partners(email);
CREATE INDEX IF NOT EXISTS idx_partners_status ON partners(status);

-- Insert Tom Winter / Valdata as partner with code 'valdata'
INSERT INTO partners (
  partner_code, full_name, email, company, company_url, linkedin_url,
  primary_market, status, notes
) VALUES (
  'valdata',
  'Tom Winter',
  'tom@valdata.com',
  'Valdata Systems USA Inc.',
  'https://valdata.com',
  'https://www.linkedin.com/company/valdata-systems-usa-inc',
  'cosmetics_waitlist',
  'active',
  'Strategic MoCRA-ahead partner. ERP vendor with installed base of cosmetics manufacturers (21 CFR Part 11 compliant) and some ethical drug manufacturers. Cross-promotion expected. Approved 2026-05-07.'
)
ON CONFLICT (partner_code) DO NOTHING;