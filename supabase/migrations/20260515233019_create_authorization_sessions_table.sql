-- Authorization sessions: parent context grouping IRRs from the same decision moment
-- One inspection / batch review / CAPA closure can produce multiple authorization artifacts

CREATE TABLE IF NOT EXISTS authorization_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_type TEXT CHECK (session_type IN (
    'inspection',
    'batch_review',
    'capa_closure',
    'investigation',
    'audit',
    'change_review',
    'other'
  )),
  session_context JSONB,
  staging_id BIGINT REFERENCES warm_outbound_staging(id),
  attio_record_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_staging_id
ON authorization_sessions(staging_id);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_attio_record_id
ON authorization_sessions(attio_record_id);

COMMENT ON TABLE authorization_sessions IS
'Parent context for authorization artifacts. One decision moment (inspection, batch review, CAPA closure) may produce multiple IRRs — they share a session_id so the corpus can later analyze approval-chain behavior across artifacts.';