-- Commitments need new targets aligned to the 70/30 model
-- Content: 5 posts/week, Outbound: 10-15 LinkedIn/day + 50-100 email/day
-- Convergence: all paths land in IRR or case file purchase

-- Add source and entry_point tracking to outreach_touches for convergence reporting
ALTER TABLE outreach_touches ADD COLUMN IF NOT EXISTS source_type TEXT 
  CHECK (source_type IN ('inbound', 'outbound'));
ALTER TABLE outreach_touches ADD COLUMN IF NOT EXISTS entry_point TEXT;
ALTER TABLE outreach_touches ADD COLUMN IF NOT EXISTS outcome TEXT 
  CHECK (outcome IN ('irr', 'case_file', 'purchase', 'no_response', 'in_progress', NULL));

-- Add a target_list table for the tight ICP targeting
CREATE TABLE IF NOT EXISTS outbound_target_cohort (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  email TEXT,
  linkedin_url TEXT,
  full_name TEXT,
  job_title TEXT,
  company TEXT,
  company_domain TEXT,
  
  -- Qualification
  icp_role TEXT CHECK (icp_role IN ('qa_director', 'vp_quality', 'regulatory_lead', 'other')),
  trigger_type TEXT CHECK (trigger_type IN ('fda_483', 'warning_letter', 'pai_activity', 'none')),
  trigger_date DATE,
  trigger_source_url TEXT,
  
  -- Outbound state
  linkedin_sent_at TIMESTAMPTZ,
  email_sent_at TIMESTAMPTZ,
  replied BOOLEAN DEFAULT FALSE,
  replied_at TIMESTAMPTZ,
  reply_channel TEXT,
  
  -- Convergence
  moved_to_dm_at TIMESTAMPTZ,
  landed_on_irr_at TIMESTAMPTZ,
  purchased_at TIMESTAMPTZ,
  
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'sent_linkedin', 'sent_email', 'replied', 'converged', 'purchased', 'dead'))
);

CREATE INDEX IF NOT EXISTS idx_outbound_cohort_status ON outbound_target_cohort(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_cohort_trigger ON outbound_target_cohort(trigger_type, trigger_date DESC);

-- Daily send log to enforce volume constraints
CREATE TABLE IF NOT EXISTS outbound_daily_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  send_date DATE NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('linkedin', 'email')),
  target_id UUID REFERENCES outbound_target_cohort(id),
  message_sent TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(send_date, channel, target_id)
);

CREATE INDEX IF NOT EXISTS idx_outbound_daily_log_date ON outbound_daily_log(send_date DESC);