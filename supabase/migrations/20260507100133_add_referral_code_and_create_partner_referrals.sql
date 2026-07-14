-- 1. Add columns the partner-report and partner-connect functions expect
ALTER TABLE partner_applications 
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_connect_onboarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- 2. Create partner_referrals table the portal expects
CREATE TABLE IF NOT EXISTS partner_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_code text NOT NULL,
  partner_name text,
  partner_email text,
  client_name text NOT NULL,
  client_company text,
  client_email text NOT NULL,
  client_title text,
  introduction_date date,
  introduction_method text,
  notes text,
  status text DEFAULT 'pending',
  verified boolean DEFAULT false,
  verified_at timestamptz,
  total_earnings_usd numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pr_partner_code ON partner_referrals(partner_code);
CREATE INDEX IF NOT EXISTS idx_pr_client_email ON partner_referrals(client_email);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pr_partner_client ON partner_referrals(partner_code, client_email);

-- 3. Allow anon read on partner_referrals (portal queries via anon key)
ALTER TABLE partner_referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_partner_referrals" ON partner_referrals;
CREATE POLICY "anon_select_partner_referrals" ON partner_referrals 
  FOR SELECT TO anon USING (true);

-- 4. Standardize Tom's partner_code from valdata to CW-WINTER-01
UPDATE partners SET partner_code = 'CW-WINTER-01' WHERE partner_code = 'valdata';

-- 5. Update Tom's existing partner_applications row to be approved with the new referral code
UPDATE partner_applications 
SET 
  referral_code = 'CW-WINTER-01',
  status = 'approved',
  approved_at = now()
WHERE email = 'tom@valdata.com';

-- 6. If Tom's application row doesn't exist yet, create it
INSERT INTO partner_applications (
  full_name, email, company, company_url, role_type, linkedin_url,
  primary_market, status, created_at, referral_code, approved_at
)
SELECT 
  'Tom Winter', 'tom@valdata.com', 'Valdata Systems USA Inc.', 
  'https://valdata.com', 'partner', 'https://linkedin.com/in/tom-winter',
  'cosmetics, OTC, ethical drugs', 'approved', now(), 'CW-WINTER-01', now()
WHERE NOT EXISTS (SELECT 1 FROM partner_applications WHERE email = 'tom@valdata.com');