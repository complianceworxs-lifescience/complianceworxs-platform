ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS dm_draft_body text,
  ADD COLUMN IF NOT EXISTS dm_drafted_at timestamptz,
  ADD COLUMN IF NOT EXISTS dm_connection_request_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS dm_connection_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS dm_first_message_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS dm_replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS dm_phantombuster_container_id text,
  ADD COLUMN IF NOT EXISTS dm_status text;

CREATE INDEX IF NOT EXISTS idx_wos_dm_ready 
  ON warm_outbound_staging (dm_status, dm_connection_request_sent_at)
  WHERE automation_paused = false;

CREATE TABLE IF NOT EXISTS dm_send_budget_schedule (
  effective_date date PRIMARY KEY,
  daily_budget integer NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

INSERT INTO dm_send_budget_schedule (effective_date, daily_budget, notes)
VALUES ('2026-05-05', 14, 'LinkedIn cap is ~100/week. 14/day = 98/week. Stays under jail threshold.')
ON CONFLICT (effective_date) DO NOTHING;