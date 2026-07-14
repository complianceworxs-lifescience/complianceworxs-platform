alter table public.irr_sessions
  add column if not exists delivery_email_sent_at timestamptz;