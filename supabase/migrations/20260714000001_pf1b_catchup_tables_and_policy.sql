-- PF-1B CATCH-UP MIGRATION (out-of-band recovery)
-- These objects existed in production (project balkvbmtummehgbbeqap) but were
-- created outside the migration history (SQL editor/dashboard). Captured here from
-- their live definitions so the migration set fully reproduces production.
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP+CREATE): safe to re-apply.

CREATE TABLE IF NOT EXISTS public.batch_review_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  ref_code text,
  name text,
  company text,
  role text,
  contact text,
  package_type text,
  known_gap text,
  caught_gap text,
  right_findings text,
  wrong_findings text,
  missed_findings text,
  traceability_score integer,
  investigator_ready_score integer,
  run_before_inspection text,
  every_batch_condition text,
  comments text,
  CONSTRAINT batch_review_feedback_pkey PRIMARY KEY (id)
);
ALTER TABLE public.batch_review_feedback ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.free_reviews (
  email text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  first_used timestamp with time zone NOT NULL DEFAULT now(),
  last_used timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT free_reviews_pkey PRIMARY KEY (email)
);
ALTER TABLE public.free_reviews ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.irr_siblings (
  session_id text NOT NULL,
  prompt_version text NOT NULL DEFAULT 'irr-siblings-v1'::text,
  documents jsonb NOT NULL,
  model text,
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT irr_siblings_pkey PRIMARY KEY (session_id, prompt_version)
);
ALTER TABLE public.irr_siblings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon insert only" ON public.batch_review_feedback;
CREATE POLICY "anon insert only" ON public.batch_review_feedback AS PERMISSIVE FOR INSERT TO anon WITH CHECK (true);

