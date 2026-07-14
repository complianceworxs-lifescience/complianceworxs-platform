-- Pending one-click approvals: each row is a drafted action waiting for Jon's tap
CREATE TABLE IF NOT EXISTS pending_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  executed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '14 days'),
  
  commitment_id UUID REFERENCES operator_commitments(id),
  action_type TEXT NOT NULL CHECK (action_type IN (
    'send_email', 'send_linkedin_dm', 'post_linkedin', 
    'create_stripe_refund', 'update_customer_lifecycle', 'custom'
  )),
  
  target_email TEXT,
  target_name TEXT,
  target_attio_id TEXT,
  subject TEXT,
  draft_body TEXT NOT NULL,
  
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'sent', 'failed', 'killed', 'expired')),
  
  approval_token TEXT NOT NULL UNIQUE,
  result_log TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pending_approvals_status
  ON pending_approvals(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pending_approvals_token
  ON pending_approvals(approval_token);

-- Calendar event tracking — so we don't double-book
CREATE TABLE IF NOT EXISTS commitment_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id UUID REFERENCES operator_commitments(id),
  google_event_id TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT DEFAULT 30,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-close audit: what did the system close on its own, when, and why
CREATE TABLE IF NOT EXISTS autoclose_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  commitment_id UUID REFERENCES operator_commitments(id),
  closed_because TEXT NOT NULL,
  evidence JSONB
);