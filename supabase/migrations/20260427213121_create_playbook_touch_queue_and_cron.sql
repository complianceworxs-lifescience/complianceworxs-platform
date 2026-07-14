
CREATE TABLE IF NOT EXISTS playbook_touch_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES playbook_executions(id) ON DELETE CASCADE,
  touch_number INT NOT NULL,
  variant_label TEXT NOT NULL,
  channel TEXT NOT NULL,
  target_name TEXT,
  target_linkedin TEXT,
  target_email TEXT,
  target_company TEXT,
  message_rendered TEXT NOT NULL,
  closer_line TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped', 'cancelled')),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  send_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_playbook_touch_queue_status ON playbook_touch_queue(status, queued_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_playbook_touch_queue_execution ON playbook_touch_queue(execution_id);

-- Schedule the progressor to run every 30 minutes
SELECT cron.schedule(
  'playbook-progressor-30min',
  '*/30 * * * *',
  $$ SELECT net.http_get(url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/playbook-progressor?secret=3i_6DdFRT-EmxT0nczskfeA3HshAnu64w40C9-WmkAE', timeout_milliseconds := 30000); $$
);
