CREATE TABLE IF NOT EXISTS irr_stage_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  stage int NOT NULL,
  stage_name text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms int,
  attempt int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 2,
  output_json jsonb,
  classified_failure text,
  error_detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, stage)
);

CREATE OR REPLACE FUNCTION claim_next_active_irr_job()
RETURNS SETOF irr_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  claimed_id uuid;
BEGIN
  SELECT job_id INTO claimed_id
  FROM irr_jobs
  WHERE status IN ('queued', 'running')
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF claimed_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE irr_jobs SET status = 'running', updated_at = now() WHERE job_id = claimed_id;

  RETURN QUERY SELECT * FROM irr_jobs WHERE job_id = claimed_id;
END;
$$;