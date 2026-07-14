
-- Add email and cw_user_id to sessions for identity resolution
ALTER TABLE sessions 
ADD COLUMN IF NOT EXISTS email TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS cw_user_id TEXT DEFAULT NULL;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_sessions_email 
ON sessions(email) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_cw_user_id
ON sessions(cw_user_id) WHERE cw_user_id IS NOT NULL;
