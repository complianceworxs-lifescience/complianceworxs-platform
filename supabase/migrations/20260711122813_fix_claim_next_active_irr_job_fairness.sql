CREATE OR REPLACE FUNCTION public.claim_next_active_irr_job()
RETURNS SETOF irr_jobs
LANGUAGE plpgsql
AS $function$
DECLARE
  claimed_id uuid;
BEGIN
  -- Fix: previously always claimed the oldest active job regardless of
  -- whether its current stage was already mid-flight, which meant a busy
  -- job would get reclaimed every tick while other queued jobs starved.
  -- Skip jobs whose current stage is still legitimately running (same
  -- 380s freshness window as the orchestrator's own in-progress guard) so
  -- the claim naturally round-robins across concurrently queued jobs.
  SELECT j.job_id INTO claimed_id
  FROM irr_jobs j
  WHERE j.status IN ('queued', 'running')
    AND NOT EXISTS (
      SELECT 1 FROM irr_stage_runs sr
      WHERE sr.job_id = j.job_id
        AND sr.status = 'running'
        AND sr.started_at > now() - interval '380 seconds'
    )
  ORDER BY j.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF claimed_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE irr_jobs SET status = 'running', updated_at = now() WHERE job_id = claimed_id;

  RETURN QUERY SELECT * FROM irr_jobs WHERE job_id = claimed_id;
END;
$function$;