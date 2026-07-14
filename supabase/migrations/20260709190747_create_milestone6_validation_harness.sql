CREATE TABLE IF NOT EXISTS milestone6_validation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_case_id text NOT NULL,
  gate text NOT NULL, -- 'gate1_analytical' | 'gate3_determinism' | 'gate5_regression' | 'gate6_edge_case'
  edge_case_type text, -- for gate6 only: missing_evidence | conflicting_evidence | ambiguous_record | insufficient_information | contradictory_inputs
  run_number int NOT NULL DEFAULT 1,
  input_payload jsonb NOT NULL,
  job_id uuid REFERENCES irr_jobs(job_id),
  terminal_state text,
  defensibility_rating text,
  claim_status jsonb,
  known_limitations text,
  editorial_findings jsonb,
  fabrication_flag boolean, -- gate6: did the model invent specifics instead of failing safely
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_m6_validation_gate ON milestone6_validation_runs(gate);
CREATE INDEX IF NOT EXISTS idx_m6_validation_test_case ON milestone6_validation_runs(test_case_id);