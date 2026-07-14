-- Atomic claim function: worker calls this instead of racing on a plain SELECT/UPDATE,
-- so overlapping cron invocations never double-process the same job.
create or replace function claim_next_irr_job()
returns setof irr_jobs
language plpgsql
as $$
declare
  claimed_id uuid;
begin
  select job_id into claimed_id
  from irr_jobs
  where status = 'queued'
  order by created_at asc
  limit 1
  for update skip locked;

  if claimed_id is null then
    return;
  end if;

  update irr_jobs
  set status = 'running', updated_at = now()
  where job_id = claimed_id;

  return query select * from irr_jobs where job_id = claimed_id;
end;
$$;

-- Helpful for the ORDER BY in the claim query as job volume grows.
create index if not exists irr_jobs_status_created_at_idx on irr_jobs (status, created_at);

-- Reset the 7 jobs that have been stuck at status='running' with no terminal_state
-- since before this fix existed. They were abandoned mid-flight by the old
-- EdgeRuntime.waitUntil pattern and never actually ran the pipeline to completion.
-- Their input_payload is intact, so re-queuing lets the new worker process them for real.
update irr_jobs
set status = 'queued', updated_at = now()
where status = 'running' and terminal_state is null;
