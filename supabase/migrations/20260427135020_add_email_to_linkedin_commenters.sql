
ALTER TABLE linkedin_commenters
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS email_confidence INT,
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS company_domain TEXT,
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrichment_source TEXT,
  ADD COLUMN IF NOT EXISTS enrichment_status TEXT DEFAULT 'pending' CHECK (enrichment_status IN ('pending', 'enriched', 'failed', 'skipped'));

CREATE INDEX IF NOT EXISTS idx_linkedin_commenters_email ON linkedin_commenters(LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_linkedin_commenters_enrichment_status ON linkedin_commenters(enrichment_status);

ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS company_domain TEXT,
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrichment_status TEXT DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_warm_staging_email ON warm_outbound_staging(LOWER(email)) WHERE email IS NOT NULL;
