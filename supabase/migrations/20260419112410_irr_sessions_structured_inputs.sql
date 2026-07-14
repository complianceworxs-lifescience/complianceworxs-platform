ALTER TABLE public.irr_sessions
  ADD COLUMN IF NOT EXISTS decision_statement text,
  ADD COLUMN IF NOT EXISTS reference_id text,
  ADD COLUMN IF NOT EXISTS source_record text,
  ADD COLUMN IF NOT EXISTS evidence_items jsonb,
  ADD COLUMN IF NOT EXISTS authorizer_review text,
  ADD COLUMN IF NOT EXISTS authorizer_conclusion text,
  ADD COLUMN IF NOT EXISTS decision_date date,
  ADD COLUMN IF NOT EXISTS evidence_available boolean,
  ADD COLUMN IF NOT EXISTS justification text;