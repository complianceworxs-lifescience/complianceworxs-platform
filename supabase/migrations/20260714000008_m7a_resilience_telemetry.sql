-- Milestone 7A (CW-MDR-007A) — M7A-12 resilience telemetry (build step 5).
--
-- ADDITIVE ONLY. This migration:
--   * adds ONE new nullable column (`error_category`) to irr_stage_runs — a nullable column
--     with no default, so PostgreSQL does NOT rewrite existing rows and no existing irr_* data
--     is touched;
--   * creates ONE new isolated table (`m7a_retry_events`) + its indexes/RLS.
-- It issues NO `ALTER COLUMN`, NO `DROP`, NO `UPDATE`/`DELETE`/`TRUNCATE`, and does not modify
-- irr_jobs, irr_regression_runs, or any pre-existing object other than the additive column above.
-- Idempotent (IF NOT EXISTS). Lands after the M7 isolation migration (…000007).
--
-- D-4 resolved: retry telemetry uses a dedicated append-only table, not columns on
-- irr_stage_runs — the stage row is mutated in place per attempt and cannot preserve per-attempt
-- delay history, which is exactly what "attempts and delays measurable" (M7A-04/A-04) needs.

-- ── error_category on the stage-run row (colocated with classified_failure) ─────────────────
ALTER TABLE public.irr_stage_runs ADD COLUMN IF NOT EXISTS error_category text;

-- ── append-only retry/failure telemetry (M7A-12) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.m7a_retry_events (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  job_id      uuid,
  stage       integer,
  stage_name  text,
  attempt     integer,
  reason      text,          -- normalized reason (e.g. rate_limit, authentication_error)
  category    text,          -- error category (operational | model_output | contract | business_logic | infrastructure)
  action      text,          -- 'retry' | 'terminal'
  delay_ms    integer,       -- computed backoff for a retry (recorded, not enforced — D-2(a))
  source      text,          -- 'irr-stage-engine' | 'irr-job-worker'
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT m7a_retry_events_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS m7a_retry_events_job_id_idx ON public.m7a_retry_events (job_id);
CREATE INDEX IF NOT EXISTS m7a_retry_events_created_at_idx ON public.m7a_retry_events (created_at);

-- Explicit RLS (no reliance on the ensure_rls event trigger; M7 precedent). Internal telemetry:
-- service_role only; anon/authenticated denied by default (RLS on, no permissive policy).
ALTER TABLE public.m7a_retry_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS m7a_retry_events_service_all ON public.m7a_retry_events;
CREATE POLICY m7a_retry_events_service_all
  ON public.m7a_retry_events AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
