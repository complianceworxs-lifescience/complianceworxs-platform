CREATE TABLE IF NOT EXISTS phantombuster_lead_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  linkedin_url TEXT NOT NULL UNIQUE,
  source_agent TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  company TEXT,
  company_domain TEXT,
  job_title TEXT,
  location TEXT,
  industry TEXT,
  connection_degree TEXT,
  shared_connections INT,
  hunter_enrichment_status TEXT DEFAULT 'pending',
  qualification_status TEXT DEFAULT 'not_reviewed',
  qualification_notes TEXT,
  outbound_status TEXT DEFAULT 'not_contacted',
  raw_row JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pb_imports_hunter_status ON phantombuster_lead_imports(hunter_enrichment_status) WHERE hunter_enrichment_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pb_imports_qual_status ON phantombuster_lead_imports(qualification_status);
CREATE INDEX IF NOT EXISTS idx_pb_imports_outbound_status ON phantombuster_lead_imports(outbound_status);
CREATE INDEX IF NOT EXISTS idx_pb_imports_imported_at ON phantombuster_lead_imports(imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_pb_imports_contact_id ON phantombuster_lead_imports(contact_id);