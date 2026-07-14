CREATE TABLE IF NOT EXISTS public.job_postings (
  id BIGSERIAL PRIMARY KEY,
  external_id TEXT UNIQUE NOT NULL,        -- dedupe key: source + source_job_id
  source TEXT NOT NULL,                    -- 'greenhouse', 'lever', 'usajobs', 'paid'
  source_company_slug TEXT,                -- e.g. 'biomarin', 'vertex'
  
  -- Display fields matching the job-card layout
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  location TEXT,                           -- 'San Rafael, CA' or 'Remote'
  work_style TEXT,                         -- 'Remote', 'Hybrid', 'On-Site'
  employment_type TEXT DEFAULT 'Full-Time',
  category TEXT,                           -- 'QA', 'Regulatory Affairs', 'Validation', 'Compliance'
  apply_url TEXT NOT NULL,
  
  -- Promotion/tier
  tier TEXT NOT NULL DEFAULT 'community',  -- 'featured', 'standard', 'community'
  is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Lifecycle
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,                  -- for paid: +30 days. for community: +14 days
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- last scrape this URL appeared in
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- Filter audit
  matched_keyword TEXT,
  raw_payload JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_postings_active_tier ON job_postings (is_active, tier, published_at DESC) WHERE is_active = TRUE;
CREATE INDEX idx_job_postings_category ON job_postings (category) WHERE is_active = TRUE;
CREATE INDEX idx_job_postings_external_id ON job_postings (external_id);
CREATE INDEX idx_job_postings_expires ON job_postings (expires_at) WHERE is_active = TRUE;

COMMENT ON TABLE job_postings IS 'Job board listings for theinspectionrecord.com/jobs. Mix of paid (tier=featured|standard) and scraped (tier=community).';