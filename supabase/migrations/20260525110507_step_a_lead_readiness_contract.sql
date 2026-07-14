
-- =====================================================================
-- STEP A: Deterministic enrichment readiness contract
-- Adds explicit data contract between scrape and personalization steps.
-- Status flow: pending_initial -> ready | pending_retry -> ready | failed_enrichment
-- =====================================================================

ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS readiness_status TEXT,
  ADD COLUMN IF NOT EXISTS readiness_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS readiness_retry_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS readiness_attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS readiness_block_reasons JSONB,
  ADD COLUMN IF NOT EXISTS readiness_failed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_warm_readiness_status
  ON warm_outbound_staging (readiness_status)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_warm_readiness_retry_due
  ON warm_outbound_staging (readiness_retry_due_at)
  WHERE readiness_status = 'pending_retry' AND archived_at IS NULL;

-- =====================================================================
-- Deterministic readiness check. Pure SQL. No AI. No judgment.
-- Returns the list of block reasons; empty array means ready.
-- =====================================================================
CREATE OR REPLACE FUNCTION compute_lead_readiness_blocks(row_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  r RECORD;
  blocks TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT
    linkedin_url, linkedin_headline, linkedin_description,
    job_title, full_name, company, first_name
  INTO r
  FROM warm_outbound_staging
  WHERE id = row_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_array('row_not_found');
  END IF;

  IF r.linkedin_url IS NULL OR length(trim(r.linkedin_url)) = 0 THEN
    blocks := array_append(blocks, 'missing_linkedin_url');
  END IF;

  IF r.linkedin_headline IS NULL OR length(trim(r.linkedin_headline)) = 0 THEN
    blocks := array_append(blocks, 'missing_linkedin_headline');
  END IF;

  IF r.linkedin_description IS NULL OR length(trim(r.linkedin_description)) < 50 THEN
    blocks := array_append(blocks, 'linkedin_description_too_short');
  END IF;

  IF r.job_title IS NULL OR length(trim(r.job_title)) = 0 THEN
    blocks := array_append(blocks, 'missing_job_title');
  END IF;

  IF r.first_name IS NULL OR length(trim(r.first_name)) = 0 THEN
    blocks := array_append(blocks, 'missing_first_name');
  END IF;

  IF r.company IS NULL OR length(trim(r.company)) = 0 THEN
    blocks := array_append(blocks, 'missing_company');
  END IF;

  RETURN to_jsonb(blocks);
END;
$$;

-- =====================================================================
-- Apply the readiness check to a single row, advancing its state machine.
-- Called by a cron job or trigger; safe to call repeatedly.
-- =====================================================================
CREATE OR REPLACE FUNCTION evaluate_lead_readiness(row_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  blocks JSONB;
  block_count INT;
  current_status TEXT;
  current_attempts INT;
  new_status TEXT;
BEGIN
  blocks := compute_lead_readiness_blocks(row_id);
  block_count := jsonb_array_length(blocks);

  SELECT readiness_status, COALESCE(readiness_attempts, 0)
  INTO current_status, current_attempts
  FROM warm_outbound_staging
  WHERE id = row_id;

  IF block_count = 0 THEN
    -- All fields present. Lead is ready for personalization.
    new_status := 'ready';
    UPDATE warm_outbound_staging
    SET readiness_status = new_status,
        readiness_checked_at = NOW(),
        readiness_block_reasons = blocks,
        readiness_retry_due_at = NULL
    WHERE id = row_id;
  ELSE
    -- Missing data. Decide between pending_retry and failed_enrichment.
    IF current_attempts = 0 THEN
      -- First failure: schedule a retry in 48 hours.
      new_status := 'pending_retry';
      UPDATE warm_outbound_staging
      SET readiness_status = new_status,
          readiness_checked_at = NOW(),
          readiness_block_reasons = blocks,
          readiness_attempts = 1,
          readiness_retry_due_at = NOW() + INTERVAL '48 hours'
      WHERE id = row_id;
    ELSE
      -- Second (or later) failure: archive.
      new_status := 'failed_enrichment';
      UPDATE warm_outbound_staging
      SET readiness_status = new_status,
          readiness_checked_at = NOW(),
          readiness_block_reasons = blocks,
          readiness_attempts = current_attempts + 1,
          readiness_failed_at = NOW(),
          archived_at = NOW(),
          archive_reason = 'enrichment_failed_after_retry'
      WHERE id = row_id;
    END IF;
  END IF;

  RETURN new_status;
END;
$$;

-- =====================================================================
-- View: leads currently eligible for personalization.
-- Personalization step reads from here, NOT from the raw table.
-- =====================================================================
CREATE OR REPLACE VIEW v_leads_ready_for_personalization AS
SELECT *
FROM warm_outbound_staging
WHERE readiness_status = 'ready'
  AND archived_at IS NULL
  AND personalization_status IS DISTINCT FROM 'completed'
  AND fit_scored_at IS NOT NULL;

-- =====================================================================
-- View: leads waiting for re-scrape (retry window elapsed or not yet)
-- =====================================================================
CREATE OR REPLACE VIEW v_leads_pending_rescrape AS
SELECT *,
  (readiness_retry_due_at <= NOW()) AS retry_window_elapsed
FROM warm_outbound_staging
WHERE readiness_status = 'pending_retry'
  AND archived_at IS NULL;

-- =====================================================================
-- Log table so every readiness state change is observable
-- =====================================================================
CREATE TABLE IF NOT EXISTS pipeline_readiness_log (
  id BIGSERIAL PRIMARY KEY,
  staging_row_id BIGINT NOT NULL,
  prior_status TEXT,
  new_status TEXT NOT NULL,
  block_reasons JSONB,
  attempts INT,
  evaluated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_readiness_log_row
  ON pipeline_readiness_log (staging_row_id, evaluated_at DESC);
