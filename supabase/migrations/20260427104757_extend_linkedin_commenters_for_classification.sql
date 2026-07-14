
ALTER TABLE linkedin_commenters
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS degree TEXT,
  ADD COLUMN IF NOT EXISTS classification TEXT CHECK (classification IN ('prospect', 'not_prospect', 'partner', 'retired', 'pending_review')),
  ADD COLUMN IF NOT EXISTS classification_reason TEXT,
  ADD COLUMN IF NOT EXISTS word_count INT,
  ADD COLUMN IF NOT EXISTS post_url TEXT,
  ADD COLUMN IF NOT EXISTS commented_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attio_person_id TEXT,
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT DEFAULT 'commented',
  ADD COLUMN IF NOT EXISTS sequence_status TEXT DEFAULT 'not_started';

CREATE UNIQUE INDEX IF NOT EXISTS idx_linkedin_commenters_url ON linkedin_commenters(linkedin_url) WHERE linkedin_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_linkedin_commenters_classification ON linkedin_commenters(classification);
