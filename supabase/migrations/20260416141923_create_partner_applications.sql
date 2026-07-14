
CREATE TABLE IF NOT EXISTS partner_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL,
  company         TEXT,
  role_type       TEXT,
  linkedin_url    TEXT,
  client_base     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  status          TEXT DEFAULT 'pending' NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_partner_applications_email ON partner_applications(email);
CREATE INDEX IF NOT EXISTS idx_partner_applications_status ON partner_applications(status);
CREATE INDEX IF NOT EXISTS idx_partner_applications_created ON partner_applications(created_at DESC);

ALTER TABLE partner_applications ENABLE ROW LEVEL SECURITY;

-- Allow public insert (sign-up form), no public read
CREATE POLICY "Allow public insert" ON partner_applications
  FOR INSERT WITH CHECK (true);
