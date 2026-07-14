CREATE TABLE IF NOT EXISTS exposure_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Submitter
  email text NOT NULL,
  full_name text,
  company text,
  role text,
  
  -- Submission content
  decision_type text NOT NULL, -- CAPA Closure, Batch Release, Deviation Disposition, Safety Substantiation, Supplier Qualification, Change Control, Other
  regulatory_framework text, -- FDA, MoCRA, EU GMP, ICH, etc.
  decision_authorized text NOT NULL, -- What decision was authorized?
  evidence_supporting text NOT NULL, -- What evidence supported the authorization?
  investigator_view text NOT NULL, -- What would an investigator see in the record today?
  supporting_document_url text, -- Optional uploaded file URL
  
  -- Attribution
  partner_code text, -- e.g. VALDATA — captured from cw_ref cookie or query param
  source_page text, -- e.g. /partners/valdata
  
  -- Lifecycle
  status text DEFAULT 'received', -- received, in_review, snapshot_delivered, irr_purchased, closed
  submitted_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  snapshot_delivered_at timestamptz,
  reviewed_by text,
  internal_notes text,
  
  -- Output
  exposure_flags jsonb,
  reconstructability_gaps text,
  missing_authorization_logic text,
  example_investigator_challenge text,
  irr_recommendation text,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_es_email ON exposure_submissions(email);
CREATE INDEX IF NOT EXISTS idx_es_partner_code ON exposure_submissions(partner_code);
CREATE INDEX IF NOT EXISTS idx_es_status ON exposure_submissions(status);
CREATE INDEX IF NOT EXISTS idx_es_submitted_at ON exposure_submissions(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_es_decision_type ON exposure_submissions(decision_type);

-- RLS — only service role writes, no anon read
ALTER TABLE exposure_submissions ENABLE ROW LEVEL SECURITY;