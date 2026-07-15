-- Milestone 7 (CW-MDR-007) — M7-11 regression isolation.
-- Creates TWO NEW, ISOLATED tables for the M7 regression harness. Per DR §13 (D-1
-- resolved) these are dedicated tables, NOT an extension of irr_jobs / irr_stage_runs /
-- irr_regression_runs, so a regression run can never read, write, or contend with
-- production job rows, and its membership cannot intersect a production-table time window
-- (satisfies A-M4 / N-07).
--
-- This migration ONLY creates new objects (CREATE TABLE IF NOT EXISTS, indexes, RLS,
-- policies) on the two m7_* tables. It issues NO ALTER/DROP/UPDATE/DELETE against
-- irr_jobs, irr_stage_runs, irr_regression_runs, or any other pre-existing object.
--
-- RLS is defined explicitly here (ALTER ... ENABLE ROW LEVEL SECURITY + explicit
-- CREATE POLICY on each table). It does NOT rely on the PF-1B ensure_rls event trigger,
-- so it is unaffected by the PF-1B RLS-replay caveat. Idempotent: safe to re-apply.

-- ── Run registry ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.m7_regression_runs (
  run_id         uuid NOT NULL DEFAULT gen_random_uuid(),
  corpus_version text NOT NULL,
  corpus_hash    text NOT NULL,
  status         text NOT NULL DEFAULT 'running',
  total          integer NOT NULL DEFAULT 0,
  passed         integer NOT NULL DEFAULT 0,
  failed         integer NOT NULL DEFAULT 0,
  started_at     timestamp with time zone NOT NULL DEFAULT now(),
  completed_at   timestamp with time zone,
  CONSTRAINT m7_regression_runs_pkey PRIMARY KEY (run_id)
);

-- ── Per-case results (child of a run) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.m7_regression_case_results (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL,
  case_id         text NOT NULL,
  scenario        text,
  stage           text,
  expected_status text,
  actual_status   text,
  outcome         text NOT NULL,
  error_detail    text,
  created_at      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT m7_regression_case_results_pkey PRIMARY KEY (id),
  CONSTRAINT m7_regression_case_results_run_fk
    FOREIGN KEY (run_id) REFERENCES public.m7_regression_runs (run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS m7_regression_case_results_run_id_idx
  ON public.m7_regression_case_results (run_id);

-- ── Explicit RLS (no reliance on the ensure_rls event trigger) ─────────────────────
ALTER TABLE public.m7_regression_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m7_regression_case_results ENABLE ROW LEVEL SECURITY;

-- Internal verification tables: writes/reads are performed by the regression runner via
-- the service role. Explicit service_role policies document that intent; no policy is
-- granted to anon/authenticated, so those roles are denied by default (RLS enabled with
-- no permissive policy = deny). service_role bypasses RLS, so the runner is unaffected.
DROP POLICY IF EXISTS m7_regression_runs_service_all ON public.m7_regression_runs;
CREATE POLICY m7_regression_runs_service_all
  ON public.m7_regression_runs AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS m7_regression_case_results_service_all ON public.m7_regression_case_results;
CREATE POLICY m7_regression_case_results_service_all
  ON public.m7_regression_case_results AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
