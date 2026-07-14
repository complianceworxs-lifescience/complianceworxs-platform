CREATE TABLE IF NOT EXISTS lead_outreach_log (
  id BIGSERIAL PRIMARY KEY,
  lead_email TEXT NOT NULL,
  template_key TEXT,         -- which CW template/sequence step
  subject TEXT,
  status TEXT,               -- sent | bounced | replied | failed
  error_message TEXT,
  mailersend_id TEXT,        -- legacy column name; holds gmail message_id or send-tool id
  staging_id BIGINT,
  attio_record_id TEXT,
  source TEXT,               -- 'manual_send' | 'attio_dispatcher' | 'reply-detected'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outreach_log_email ON lead_outreach_log (LOWER(lead_email));
CREATE INDEX IF NOT EXISTS idx_outreach_log_template ON lead_outreach_log (template_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_log_status ON lead_outreach_log (status, created_at DESC);

-- Bridge: every outreach send becomes an outbound_event for PostHog
CREATE OR REPLACE FUNCTION bridge_outreach_log_to_events()
RETURNS TRIGGER AS $$
DECLARE
  v_event_name TEXT;
BEGIN
  v_event_name := CASE 
    WHEN NEW.status = 'sent' THEN 'outreach_email_sent'
    WHEN NEW.status = 'bounced' THEN 'outreach_email_bounced'
    WHEN NEW.status = 'failed' THEN 'outreach_email_failed'
    WHEN NEW.status = 'replied' THEN 'outreach_reply_logged'  -- distinct from outbound_reply_received
    ELSE 'outreach_email_unknown'
  END;
  
  INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
  VALUES (
    NEW.staging_id, NEW.attio_record_id, NEW.lead_email, v_event_name,
    COALESCE(NEW.source, 'unknown'),
    jsonb_build_object(
      'template_key', NEW.template_key,
      'subject', NEW.subject,
      'status', NEW.status,
      'message_id', NEW.mailersend_id,
      'error', NEW.error_message
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lead_outreach_log_to_events ON lead_outreach_log;
CREATE TRIGGER lead_outreach_log_to_events
AFTER INSERT ON lead_outreach_log
FOR EACH ROW
EXECUTE FUNCTION bridge_outreach_log_to_events();