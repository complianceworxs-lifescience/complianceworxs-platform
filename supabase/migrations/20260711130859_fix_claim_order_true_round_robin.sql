CREATE OR REPLACE FUNCTION public.claim_next_active_irr_job()
RETURNS SETOF irr_jobs
LANGUAGE plpgsql
AS $function$
DECLARE
  claimed_id uuid;
BEGIN
  -- Second fairness fix: ORDER BY created_at ASC still let the same small
  -- subset of jobs win every tie-break, because 15 jobs inserted in one
  -- batch share near-identical created_at, and Postgres' tie order for
  -- equal timestamps is stable -- so whichever jobs won the physical tie
  -- kept winning every time they cycled back to eligible, and the rest
  -- never got a turn until stallReclaim killed them at 10 minutes. This is
  -- the actual definition of round-robin: order by LEAST RECENTLY TOUCHED,
  -- not by creation time. A job that was just worked moves to the back of
  -- the line; a job that's been waiting longest goes next.
  SELECT j.job_id INTO claimed_id
  FROM irr_jobs j
  WHERE j.status IN ('queued', 'running')
    AND NOT EXISTS (
      SELECT 1 FROM irr_stage_runs sr
      WHERE sr.job_id = j.job_id
        AND sr.status = 'running'
        AND sr.started_at > now() - interval '380 seconds'
    )
  ORDER BY j.updated_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF claimed_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE irr_jobs SET status = 'running', updated_at = now() WHERE job_id = claimed_id;

  RETURN QUERY SELECT * FROM irr_jobs WHERE job_id = claimed_id;
END;
$function$;