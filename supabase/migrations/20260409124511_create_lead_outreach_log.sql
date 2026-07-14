
CREATE TABLE IF NOT EXISTS lead_outreach_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_email      text NOT NULL,
  template_key    text NOT NULL,
  subject         text NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'sent',
  error_message   text,
  mailersend_id   text
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_outreach_log_email_template
  ON lead_outreach_log (lead_email, template_key);
