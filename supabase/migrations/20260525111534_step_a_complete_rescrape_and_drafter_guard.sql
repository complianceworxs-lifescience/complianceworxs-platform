
-- =====================================================================
-- PART 1: Re-scrape worker
-- A SQL function that picks rows whose 48h window has elapsed, resets
-- their state so prospeo-linkedin-enrich (which runs every 15min) picks
-- them up again, then re-evaluates readiness if the enricher updates them.
-- =====================================================================

-- Mark eligible retry rows as needing re-enrichment. The existing
-- prospeo-linkedin-enrich function selects rows where enrichment_status
-- IS NULL or = 'pending', so we reset that field for retry rows.
CREATE OR REPLACE FUNCTION trigger_lead_rescrapes()
RETURNS TABLE(staging_row_id BIGINT, action TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
  retry_row RECORD;
  prior_enrich_status TEXT;
BEGIN
  FOR retry_row IN
    SELECT id, enrichment_status
    FROM warm_outbound_staging
    WHERE readiness_status = 'pending_retry'
      AND readiness_retry_due_at <= NOW()
      AND archived_at IS NULL
    ORDER BY readiness_retry_due_at ASC
    LIMIT 50  -- protect PhantomBuster credit burn per run
  LOOP
    prior_enrich_status := retry_row.enrichment_status;

    -- Reset enrichment_status so the existing 15-min enricher will retry.
    -- Stamp readiness_attempts = 1 already happened on first failure;
    -- the next evaluate_lead_readiness() call after re-enrichment will
    -- either move row to 'ready' or to 'failed_enrichment' (since attempts>=1).
    UPDATE warm_outbound_staging
    SET enrichment_status = 'pending_retry_rescrape',
        readiness_status = 'rescrape_in_flight',
        readiness_checked_at = NOW()
    WHERE id = retry_row.id;

    INSERT INTO pipeline_readiness_log
      (staging_row_id, prior_status, new_status, block_reasons, attempts)
    VALUES
      (retry_row.id, 'pending_retry', 'rescrape_in_flight',
       jsonb_build_object('prior_enrichment_status', prior_enrich_status), 1);

    staging_row_id := retry_row.id;
    action := 'queued_for_rescrape';
    RETURN NEXT;
  END LOOP;
END;
$$;

-- =====================================================================
-- PART 2: Re-evaluate after enrichment
-- After prospeo writes new linkedin fields, we need to re-run readiness.
-- This trigger fires on UPDATE when LinkedIn fields change, and only for
-- rows in rescrape_in_flight state, so it doesn't fire on every update.
-- =====================================================================
CREATE OR REPLACE FUNCTION trg_reevaluate_readiness_after_rescrape()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.readiness_status = 'rescrape_in_flight'
     AND (
       NEW.linkedin_headline IS DISTINCT FROM OLD.linkedin_headline
       OR NEW.linkedin_description IS DISTINCT FROM OLD.linkedin_description
       OR NEW.linkedin_scraped_at IS DISTINCT FROM OLD.linkedin_scraped_at
     )
  THEN
    -- Defer the readiness re-evaluation to AFTER trigger via PERFORM in a
    -- separate statement isn't possible here; instead just call it inline.
    -- Note: this is a BEFORE trigger so we set fields directly.
    DECLARE
      blocks JSONB;
      block_count INT;
    BEGIN
      -- We can't call compute_lead_readiness_blocks() yet because NEW
      -- hasn't been written. Re-implement the check on NEW values.
      blocks := '[]'::jsonb;

      IF NEW.linkedin_url IS NULL OR length(trim(NEW.linkedin_url)) = 0 THEN
        blocks := blocks || jsonb_build_array('missing_linkedin_url');
      END IF;
      IF NEW.linkedin_headline IS NULL OR length(trim(NEW.linkedin_headline)) = 0 THEN
        blocks := blocks || jsonb_build_array('missing_linkedin_headline');
      END IF;
      IF NEW.linkedin_description IS NULL OR length(trim(NEW.linkedin_description)) < 50 THEN
        blocks := blocks || jsonb_build_array('linkedin_description_too_short');
      END IF;
      IF NEW.job_title IS NULL OR length(trim(NEW.job_title)) = 0 THEN
        blocks := blocks || jsonb_build_array('missing_job_title');
      END IF;
      IF NEW.first_name IS NULL OR length(trim(NEW.first_name)) = 0 THEN
        blocks := blocks || jsonb_build_array('missing_first_name');
      END IF;
      IF NEW.company IS NULL OR length(trim(NEW.company)) = 0 THEN
        blocks := blocks || jsonb_build_array('missing_company');
      END IF;

      block_count := jsonb_array_length(blocks);
      NEW.readiness_block_reasons := blocks;
      NEW.readiness_checked_at := NOW();
      NEW.readiness_attempts := COALESCE(OLD.readiness_attempts, 1) + 1;

      IF block_count = 0 THEN
        NEW.readiness_status := 'ready';
        NEW.readiness_retry_due_at := NULL;
      ELSE
        -- Second strike: archive
        NEW.readiness_status := 'failed_enrichment';
        NEW.readiness_failed_at := NOW();
        NEW.archived_at := NOW();
        NEW.archive_reason := 'enrichment_failed_after_retry';
      END IF;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS warm_outbound_reevaluate_after_rescrape ON warm_outbound_staging;
CREATE TRIGGER warm_outbound_reevaluate_after_rescrape
  BEFORE UPDATE ON warm_outbound_staging
  FOR EACH ROW
  EXECUTE FUNCTION trg_reevaluate_readiness_after_rescrape();

-- =====================================================================
-- PART 3: Drafter guard
-- Defense-in-depth: refuse any UPDATE that stamps first_touch_drafted_at
-- on a row that hasn't passed the readiness check. This is the structural
-- guardrail that stops AI-generated drafts on empty profiles, regardless
-- of which edge function or future code path is writing.
-- =====================================================================
CREATE OR REPLACE FUNCTION trg_block_draft_on_unready_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Triggered when the drafter tries to write a draft body or stamp
  -- drafted_at. Allow only if readiness_status = 'ready'.
  IF (
    (NEW.first_touch_draft_body IS NOT NULL AND OLD.first_touch_draft_body IS NULL)
    OR
    (NEW.first_touch_drafted_at IS NOT NULL AND OLD.first_touch_drafted_at IS NULL)
    OR
    (NEW.dm_draft_body IS NOT NULL AND OLD.dm_draft_body IS NULL)
  )
  AND COALESCE(NEW.readiness_status, OLD.readiness_status, '') NOT IN ('ready')
  -- Allow legacy historical rows to keep functioning: only block when
  -- readiness contract has been applied (status IS NOT NULL).
  AND (NEW.readiness_status IS NOT NULL OR OLD.readiness_status IS NOT NULL)
  THEN
    RAISE EXCEPTION 'Draft blocked: lead id % is not ready (status=%, blocks=%)',
      NEW.id,
      COALESCE(NEW.readiness_status, OLD.readiness_status),
      COALESCE(NEW.readiness_block_reasons, OLD.readiness_block_reasons);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS warm_outbound_block_unready_drafts ON warm_outbound_staging;
CREATE TRIGGER warm_outbound_block_unready_drafts
  BEFORE UPDATE ON warm_outbound_staging
  FOR EACH ROW
  EXECUTE FUNCTION trg_block_draft_on_unready_lead();

-- =====================================================================
-- PART 4: Schedule the re-scrape worker
-- Runs hourly. The function itself respects the 48h retry window so
-- no row gets retried before its time.
-- =====================================================================
SELECT cron.schedule(
  'lead-readiness-rescrape-hourly',
  '7 * * * *',  -- 7 past every hour, offset from other crons
  $$SELECT trigger_lead_rescrapes();$$
);
