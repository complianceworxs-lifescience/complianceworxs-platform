
CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_code TEXT NOT NULL UNIQUE,
  partner_name TEXT NOT NULL,
  contact_email TEXT,
  contact_full_name TEXT,
  company TEXT,
  attio_person_id TEXT,
  attio_company_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'terminated', 'pending_approval')),
  commission_rate NUMERIC(4,3) NOT NULL DEFAULT 0.250,
  commission_duration_months INT NOT NULL DEFAULT 12,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partners_code ON partners(LOWER(partner_code));
CREATE INDEX IF NOT EXISTS idx_partners_status ON partners(status);
