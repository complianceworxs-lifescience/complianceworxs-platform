
ALTER TABLE gmail_send_log
  ADD COLUMN IF NOT EXISTS send_kind             text DEFAULT 'first_touch',
  ADD COLUMN IF NOT EXISTS nurture_enrollment_id bigint,
  ADD COLUMN IF NOT EXISTS nurture_touch_number  integer,
  ADD COLUMN IF NOT EXISTS nurture_cohort        text;

CREATE INDEX IF NOT EXISTS idx_gmail_send_log_send_kind_date
  ON gmail_send_log (send_date, send_kind);
