CREATE TABLE IF NOT EXISTS stage7_diag_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid,
  status text NOT NULL DEFAULT 'running',
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);