
-- IRR sessions table — captures every Inspection Response Record generated through /irr
-- Schema matches exactly what irr-generate edge function inserts

CREATE TABLE IF NOT EXISTS public.irr_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),

  -- User inputs from the form
  question text NOT NULL,
  context text,
  decision_type text,
  decision_statement text,
  reference_id text,
  source_record text,
  evidence_items jsonb,
  authorizer_review text,
  authorizer_conclusion text,
  authority_name text,
  authority_title text,
  decision_date text,
  evidence_available boolean,
  justification text,
  email text,
  industry text DEFAULT 'pharma',

  -- Generated output from Claude
  record_json jsonb NOT NULL,
  gap_count integer DEFAULT 0,
  flags jsonb DEFAULT '[]'::jsonb,

  -- Lifecycle / commerce
  unlocked boolean NOT NULL DEFAULT false,
  unlocked_at timestamptz,
  stripe_payment_intent text
);

-- Indexes for the queries we'll actually run
CREATE INDEX IF NOT EXISTS irr_sessions_email_idx ON public.irr_sessions (email);
CREATE INDEX IF NOT EXISTS irr_sessions_created_at_idx ON public.irr_sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS irr_sessions_unlocked_idx ON public.irr_sessions (unlocked);

-- RLS: lock down the table. Only service role (edge functions) can read/write.
-- No public access — buyers never query this directly.
ALTER TABLE public.irr_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access"
  ON public.irr_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.irr_sessions IS 'Inspection Response Record sessions. Created by /irr form via irr-generate edge function. Unlocked by Stripe purchase via irr-unlock.';
