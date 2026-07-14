
ALTER TABLE sessions 
ADD COLUMN IF NOT EXISTS attio_synced_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_company_unsynced 
ON sessions(identified_company) 
WHERE identified_company IS NOT NULL AND attio_synced_at IS NULL;
