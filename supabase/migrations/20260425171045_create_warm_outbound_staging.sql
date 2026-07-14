-- Staging table for bulk push to Attio
CREATE TABLE IF NOT EXISTS public.warm_outbound_staging (
  id BIGSERIAL PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT NOT NULL,
  linkedin_url TEXT NOT NULL,
  job_title TEXT,
  case_file_interest TEXT,
  cohort_label TEXT,
  source TEXT NOT NULL,
  attio_record_id TEXT,
  pushed_at TIMESTAMPTZ,
  push_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS warm_outbound_staging_linkedin_url_idx 
  ON public.warm_outbound_staging (linkedin_url);

CREATE INDEX IF NOT EXISTS warm_outbound_staging_pending_idx
  ON public.warm_outbound_staging (id) WHERE attio_record_id IS NULL;