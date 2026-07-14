ALTER TABLE irr_stage_runs
  ADD COLUMN IF NOT EXISTS prompt_tokens int,
  ADD COLUMN IF NOT EXISTS completion_tokens int;