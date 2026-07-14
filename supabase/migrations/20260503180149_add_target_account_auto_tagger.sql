-- Auto-tagger: stamps target_account_priority on incoming leads
-- when their company matches a row in target_accounts.
-- Fires on INSERT and on UPDATE-of-company (in case Phantombuster
-- backfills the company name later).
--
-- Match logic: normalized lowercased alphanumeric comparison. Handles
-- "Curia" vs "Curia LLC" vs "Curia Pharma" via a LIKE prefix match
-- against the canonical company_name_normalized column. If a more
-- specific match is needed later, swap LIKE for exact equality.

CREATE OR REPLACE FUNCTION auto_tag_target_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_normalized TEXT;
  v_matched_id BIGINT;
  v_matched_name TEXT;
BEGIN
  -- Skip if no company, or already tagged
  IF NEW.company IS NULL OR NEW.company = '' OR NEW.target_account_priority IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Normalize incoming company name (lowercase, alphanumeric only)
  v_normalized := LOWER(REGEXP_REPLACE(NEW.company, '[^a-zA-Z0-9]', '', 'g'));

  -- Skip if normalized name is too short to be meaningful (avoids matching "a" or empty strings)
  IF LENGTH(v_normalized) < 3 THEN
    RETURN NEW;
  END IF;

  -- Match against target_accounts via prefix match.
  -- "curia" matches both "curia" and "curiaglobal" in target accounts.
  -- "rentschlerbiopharma" matches "rentschler" and "rentschlerbiopharma".
  -- We want the match where target's normalized name is a prefix of OR equal to lead's normalized name.
  SELECT id, company_name INTO v_matched_id, v_matched_name
  FROM target_accounts
  WHERE active = TRUE
    AND (
      v_normalized = company_name_normalized
      OR v_normalized LIKE company_name_normalized || '%'
      OR company_name_normalized LIKE v_normalized || '%'
    )
  ORDER BY priority_score DESC NULLS LAST
  LIMIT 1;

  IF v_matched_id IS NOT NULL THEN
    NEW.target_account_priority := 'batch_release_cohort';  -- Default cohort; refine when we add other hooks
    NEW.target_account_tagged_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_warm_outbound_auto_tag ON warm_outbound_staging;
CREATE TRIGGER trg_warm_outbound_auto_tag
  BEFORE INSERT OR UPDATE OF company ON warm_outbound_staging
  FOR EACH ROW EXECUTE FUNCTION auto_tag_target_account();

COMMENT ON FUNCTION auto_tag_target_account() IS
  'Auto-stamps target_account_priority on incoming leads matching target_accounts. '
  'Fires before INSERT or UPDATE-of-company. Idempotent: skips already-tagged rows.';