-- Track Resend bounce/complaint/delivery events for deliverability monitoring
CREATE TABLE IF NOT EXISTS resend_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  resend_event_id TEXT,                  -- Resend's event UUID for dedup
  resend_message_id TEXT NOT NULL,       -- Maps to warm_outbound_staging.send_message_id
  event_type TEXT NOT NULL,              -- email.sent | email.delivered | email.bounced | email.complained | email.opened | email.clicked | email.delivery_delayed
  staging_id BIGINT REFERENCES warm_outbound_staging(id) ON DELETE SET NULL,
  recipient_email TEXT,
  recipient_domain TEXT,
  bounce_type TEXT,                      -- 'hard' | 'soft' | 'undetermined' (only for bounces)
  bounce_subtype TEXT,                   -- e.g. 'mailbox_full', 'no_email', 'on_suppression_list'
  diagnostic_code TEXT,                  -- SMTP error / 5xx code from receiving mail server
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(resend_event_id)
);

CREATE INDEX IF NOT EXISTS idx_resend_webhook_message ON resend_webhook_events(resend_message_id);
CREATE INDEX IF NOT EXISTS idx_resend_webhook_type ON resend_webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_resend_webhook_domain ON resend_webhook_events(recipient_domain);
CREATE INDEX IF NOT EXISTS idx_resend_webhook_staging ON resend_webhook_events(staging_id);

-- Bounce/complaint flags on staging so the sender's domain throttle can read them
ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS delivery_status TEXT,           -- 'delivered' | 'bounced' | 'complained' | 'deferred'
  ADD COLUMN IF NOT EXISTS bounce_type TEXT,               -- 'hard' | 'soft'
  ADD COLUMN IF NOT EXISTS delivery_status_at TIMESTAMPTZ;

-- Suppression list: domains/emails that bounced or complained, never send to again
CREATE TABLE IF NOT EXISTS outbound_suppressions (
  id BIGSERIAL PRIMARY KEY,
  email TEXT,
  domain TEXT,
  reason TEXT NOT NULL,                  -- 'hard_bounce' | 'complaint' | 'manual_unsubscribe' | 'manual_block'
  source_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (email IS NOT NULL OR domain IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppression_email ON outbound_suppressions(LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_suppression_domain ON outbound_suppressions(domain) WHERE domain IS NOT NULL;