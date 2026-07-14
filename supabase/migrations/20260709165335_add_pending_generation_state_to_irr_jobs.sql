ALTER TABLE irr_jobs
  ADD COLUMN IF NOT EXISTS pending_generation_id text,
  ADD COLUMN IF NOT EXISTS pending_contract jsonb,
  ADD COLUMN IF NOT EXISTS pending_execution_specification jsonb,
  ADD COLUMN IF NOT EXISTS pending_prompt_package jsonb;