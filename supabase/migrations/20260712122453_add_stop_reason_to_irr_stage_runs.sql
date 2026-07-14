ALTER TABLE irr_stage_runs
  ADD COLUMN IF NOT EXISTS stop_reason text,
  ADD COLUMN IF NOT EXISTS batch_number integer,
  ADD COLUMN IF NOT EXISTS configured_max_output_tokens integer,
  ADD COLUMN IF NOT EXISTS output_char_count integer;

COMMENT ON COLUMN irr_stage_runs.stop_reason IS 'Raw stop_reason/finish_reason from the model API response (e.g. end_turn, max_tokens). Used to distinguish truncation from malformed-output failures.';
COMMENT ON COLUMN irr_stage_runs.batch_number IS 'Batch index within the stage, e.g. 5 of 6, for stages that split generation into multiple model calls.';
COMMENT ON COLUMN irr_stage_runs.configured_max_output_tokens IS 'The max_tokens value actually passed to the model call for this batch, to compare against completion_tokens and stop_reason.';
COMMENT ON COLUMN irr_stage_runs.output_char_count IS 'Character length of the raw output string returned by the model, before JSON parsing.';