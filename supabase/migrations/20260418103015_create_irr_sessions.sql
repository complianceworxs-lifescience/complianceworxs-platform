
CREATE TABLE IF NOT EXISTS irr_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  question TEXT NOT NULL,
  context TEXT,
  decision_type TEXT,
  authority_name TEXT,
  authority_title TEXT,
  record_json JSONB,
  gap_count INTEGER DEFAULT 0,
  flags JSONB DEFAULT '[]'::jsonb,
  paid BOOLEAN DEFAULT FALSE,
  stripe_session_id TEXT,
  stripe_payment_intent TEXT,
  email TEXT,
  membership_credit_expires_at TIMESTAMPTZ,
  attio_synced BOOLEAN DEFAULT FALSE
);
