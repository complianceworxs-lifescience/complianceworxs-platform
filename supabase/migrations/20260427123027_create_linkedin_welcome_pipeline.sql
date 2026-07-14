
CREATE TABLE IF NOT EXISTS linkedin_connections_snapshot (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  profile_url TEXT NOT NULL,
  full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  title TEXT,
  company TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (snapshot_date, profile_url)
);

CREATE INDEX IF NOT EXISTS idx_connections_snapshot_url ON linkedin_connections_snapshot(profile_url);
CREATE INDEX IF NOT EXISTS idx_connections_snapshot_date ON linkedin_connections_snapshot(snapshot_date DESC);

CREATE TABLE IF NOT EXISTS linkedin_welcome_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_url TEXT NOT NULL UNIQUE,
  full_name TEXT,
  first_name TEXT,
  title TEXT,
  company TEXT,
  scraped_data JSONB,
  draft_message TEXT,
  draft_status TEXT DEFAULT 'pending' CHECK (draft_status IN ('pending', 'approved', 'sent', 'skipped', 'edited')),
  approved_message TEXT,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  digest_sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_welcome_pending_status ON linkedin_welcome_pending(draft_status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_welcome_pending_approved ON linkedin_welcome_pending(approved_at) WHERE draft_status = 'approved';

-- View for Phantombuster to read approved welcomes ready to send
CREATE OR REPLACE VIEW phantombuster_welcome_queue AS
SELECT 
  full_name,
  first_name,
  profile_url,
  title,
  approved_message AS message
FROM linkedin_welcome_pending
WHERE draft_status = 'approved'
  AND sent_at IS NULL
ORDER BY approved_at ASC;

GRANT SELECT ON phantombuster_welcome_queue TO anon, authenticated;
