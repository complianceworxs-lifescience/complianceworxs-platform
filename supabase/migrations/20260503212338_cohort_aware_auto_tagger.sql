CREATE OR REPLACE FUNCTION public.auto_tag_target_account()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_normalized TEXT;
  v_matched_id BIGINT;
  v_matched_name TEXT;
  v_best_fit TEXT;
  v_cohort_slug TEXT;
BEGIN
  -- Skip if no company, or already tagged
  IF NEW.company IS NULL OR NEW.company = '' OR NEW.target_account_priority IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Normalize incoming company name (lowercase, alphanumeric only)
  v_normalized := LOWER(REGEXP_REPLACE(NEW.company, '[^a-zA-Z0-9]', '', 'g'));

  -- Skip if normalized name is too short to be meaningful
  IF LENGTH(v_normalized) < 3 THEN
    RETURN NEW;
  END IF;

  -- Match against target_accounts via prefix match (highest priority_score wins)
  SELECT id, company_name, best_fit_decision_record
    INTO v_matched_id, v_matched_name, v_best_fit
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
    -- Map the human-readable best_fit_decision_record to the cohort slug used by the drafter
    v_cohort_slug := CASE v_best_fit
      WHEN 'Batch Release Authorization'        THEN 'batch_release_cohort'
      WHEN 'Change Control Filing Determination' THEN 'change_control_cohort'
      WHEN 'Supplier Qualification Exception'    THEN 'supplier_qualification_cohort'
      WHEN 'Complaint Investigation Disposition' THEN 'complaint_investigation_cohort'
      WHEN 'Data Integrity Investigation Closure' THEN 'data_integrity_cohort'
      WHEN 'Deviation Risk Assessment'           THEN 'deviation_risk_cohort'
      WHEN 'CAPA Effectiveness'                  THEN 'capa_effectiveness_cohort'
      WHEN 'CAPA Effectiveness Determination'    THEN 'capa_effectiveness_cohort'
      ELSE 'batch_release_cohort'  -- fallback only if best_fit is unset/unknown
    END;

    NEW.target_account_priority := v_cohort_slug;
    NEW.target_account_tagged_at := NOW();
  END IF;

  RETURN NEW;
END;
$function$;