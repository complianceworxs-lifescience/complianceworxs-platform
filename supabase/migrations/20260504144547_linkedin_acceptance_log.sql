CREATE TABLE IF NOT EXISTS linkedin_acceptance_log (
  id BIGSERIAL PRIMARY KEY,
  thread_id TEXT NOT NULL,
  subject TEXT,
  from_addr TEXT,
  handler_response JSONB,
  labeled_processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_linkedin_acceptance_log_thread ON linkedin_acceptance_log (thread_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_acceptance_log_created ON linkedin_acceptance_log (created_at DESC);