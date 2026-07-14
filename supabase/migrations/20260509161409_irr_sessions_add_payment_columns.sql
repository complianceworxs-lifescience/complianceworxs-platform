
-- Add the columns that irr-unlock and irr-stripe-webhook expect
ALTER TABLE public.irr_sessions
  ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_session_id text,
  ADD COLUMN IF NOT EXISTS membership_credit_expires_at timestamptz;

-- Drop the redundant unlocked/unlocked_at columns from the first migration
-- (the working schema uses `paid` instead of `unlocked`)
ALTER TABLE public.irr_sessions
  DROP COLUMN IF EXISTS unlocked,
  DROP COLUMN IF EXISTS unlocked_at;

-- Add index on paid for quick filtering of unlocked records
CREATE INDEX IF NOT EXISTS irr_sessions_paid_idx ON public.irr_sessions (paid);
CREATE INDEX IF NOT EXISTS irr_sessions_stripe_session_idx ON public.irr_sessions (stripe_session_id);
