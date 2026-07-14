CREATE TABLE IF NOT EXISTS irr_regression_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_name text NOT NULL,
  input_payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'running',
  generation_id uuid,
  runtime_seconds numeric,
  terminal_state text,
  retry_count int,
  schema_validation text,
  contract_validation text,
  json_validation text,
  overall_result text,
  detail jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);