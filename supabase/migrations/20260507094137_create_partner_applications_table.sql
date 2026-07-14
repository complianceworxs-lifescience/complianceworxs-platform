CREATE TABLE IF NOT EXISTS partner_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  company text,
  company_url text,
  role_type text,
  linkedin_url text,
  client_base text,
  primary_market text,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_apps_email ON partner_applications(email);
CREATE INDEX IF NOT EXISTS idx_partner_apps_status ON partner_applications(status);
CREATE INDEX IF NOT EXISTS idx_partner_apps_created ON partner_applications(created_at DESC);