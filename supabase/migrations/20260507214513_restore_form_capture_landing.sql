-- Landing table for site form submissions (case file email gates, lead magnets)
-- Distinct from warm_outbound_staging because:
-- - These are INBOUND leads (already opted in, signaled interest)  
-- - They don't need fit-scoring or LinkedIn enrichment immediately
-- - They go straight to Attio with high priority

CREATE TABLE IF NOT EXISTS form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  company TEXT,
  job_title TEXT,
  source TEXT NOT NULL,           -- 'lock_overlay' | 'assessment' | 'inspection_exposure' | etc
  page TEXT,                       -- '/batch-release-authorization'
  case_file_interest TEXT,
  user_id TEXT,                    -- session/visitor ID
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  attio_record_id TEXT,
  outreach_email_sent_at TIMESTAMPTZ,
  outreach_template_key TEXT,
  spam_score INTEGER DEFAULT 0,
  spam_reasons TEXT[],
  is_blocked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT form_submissions_email_unique UNIQUE (normalized_email, source, page)
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_email ON form_submissions (normalized_email);
CREATE INDEX IF NOT EXISTS idx_form_submissions_created ON form_submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_unblocked ON form_submissions (is_blocked, created_at DESC) WHERE is_blocked = FALSE;