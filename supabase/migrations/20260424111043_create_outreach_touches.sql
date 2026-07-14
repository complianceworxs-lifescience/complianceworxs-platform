-- Clean touch-tracking for the 20/week commitment.
-- Separate from legacy lead_outreach_log which is MailerSend-era.
CREATE TABLE IF NOT EXISTS outreach_touches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ DEFAULT now(),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'linkedin_dm', 'linkedin_comment', 'other')),
  target_email TEXT,
  target_linkedin TEXT,
  target_name TEXT,
  target_company TEXT,
  target_contact_id UUID REFERENCES contacts(id),
  content_snippet TEXT,
  reply_received BOOLEAN DEFAULT FALSE,
  reply_received_at TIMESTAMPTZ,
  source TEXT DEFAULT 'manual'  -- 'manual', 'one_click_send', 'automation'
);

CREATE INDEX IF NOT EXISTS idx_outreach_touches_sent_at ON outreach_touches(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_touches_channel ON outreach_touches(channel);