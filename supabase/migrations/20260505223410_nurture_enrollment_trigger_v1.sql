
-- =============================================================================
-- Nurture Enrollment Logic
-- =============================================================================

-- Map a lead's profile to a cohort. Priority: case_file_interest -> target_account_priority -> universal
CREATE OR REPLACE FUNCTION resolve_nurture_cohort(
  p_case_file_interest text,
  p_target_account_priority text
) RETURNS text AS $$
DECLARE
  v_cohort text;
BEGIN
  -- case_file_interest is most specific (per-case-file landing page or DM)
  IF p_case_file_interest IS NOT NULL THEN
    v_cohort := lower(regexp_replace(p_case_file_interest, '[^a-zA-Z0-9_]+', '_', 'g'));
    -- normalize trailing underscore
    v_cohort := regexp_replace(v_cohort, '_+$', '');
    -- If there's a sequence for this exact cohort, use it
    IF EXISTS (SELECT 1 FROM nurture_sequences WHERE cohort = v_cohort AND active = true) THEN
      RETURN v_cohort;
    END IF;
    -- Fuzzy match on prefix (e.g. "batch-release" -> batch_release_cohort)
    SELECT cohort INTO v_cohort
    FROM nurture_sequences
    WHERE cohort ILIKE (lower(regexp_replace(p_case_file_interest, '[^a-zA-Z0-9]+', '_', 'g')) || '%')
      AND active = true
    ORDER BY cohort
    LIMIT 1;
    IF v_cohort IS NOT NULL THEN
      RETURN v_cohort;
    END IF;
  END IF;

  IF p_target_account_priority IS NOT NULL THEN
    v_cohort := lower(regexp_replace(p_target_account_priority, '[^a-zA-Z0-9_]+', '_', 'g'));
    v_cohort := regexp_replace(v_cohort, '_+$', '');
    IF EXISTS (SELECT 1 FROM nurture_sequences WHERE cohort = v_cohort AND active = true) THEN
      RETURN v_cohort;
    END IF;
  END IF;

  RETURN 'universal';
END;
$$ LANGUAGE plpgsql;

-- Main enrollment function — idempotent, safe to call multiple times.
CREATE OR REPLACE FUNCTION enroll_in_nurture(
  p_staging_id bigint,
  p_trigger_source text,
  p_trigger_detail text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_lead RECORD;
  v_cohort text;
  v_first_seq RECORD;
  v_due_at timestamptz;
  v_enrollment_id bigint;
  v_existing_active bigint;
  v_suppressed boolean;
BEGIN
  -- Validate inputs
  IF p_trigger_source NOT IN ('manual_dm_reply', 'email_reply', 'link_click') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_trigger_source');
  END IF;

  -- Fetch lead state
  SELECT id, email, full_name, case_file_interest, target_account_priority,
         is_paying_customer, automation_paused, nurture_status, attio_record_id, company_domain
    INTO v_lead
  FROM warm_outbound_staging
  WHERE id = p_staging_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'staging_id_not_found');
  END IF;

  -- Skip if lead already converted or paused
  IF v_lead.is_paying_customer = true THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_customer', 'staging_id', p_staging_id);
  END IF;
  IF v_lead.automation_paused = true THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'automation_paused', 'staging_id', p_staging_id);
  END IF;
  IF v_lead.email IS NULL OR v_lead.email = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_email_on_record', 'staging_id', p_staging_id);
  END IF;

  -- Skip if email is in suppressions list
  SELECT EXISTS(
    SELECT 1 FROM outbound_suppressions
    WHERE (email IS NOT NULL AND lower(email) = lower(v_lead.email))
       OR (email IS NULL AND domain IS NOT NULL AND domain = v_lead.company_domain)
  ) INTO v_suppressed;
  IF v_suppressed THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'suppressed', 'staging_id', p_staging_id);
  END IF;

  -- Skip if already actively enrolled
  SELECT id INTO v_existing_active
  FROM nurture_enrollments
  WHERE staging_id = p_staging_id AND status = 'active'
  LIMIT 1;
  IF v_existing_active IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_enrolled', 'enrollment_id', v_existing_active, 'staging_id', p_staging_id);
  END IF;

  -- Resolve cohort
  v_cohort := resolve_nurture_cohort(v_lead.case_file_interest, v_lead.target_account_priority);

  -- Find first touch (touch_number = 2, since 1 was the first-touch email)
  SELECT touch_number, day_offset INTO v_first_seq
  FROM nurture_sequences
  WHERE cohort = v_cohort AND touch_number = 2 AND active = true
  LIMIT 1;

  IF NOT FOUND THEN
    -- Fall back to universal if cohort sequence is missing
    v_cohort := 'universal';
    SELECT touch_number, day_offset INTO v_first_seq
    FROM nurture_sequences
    WHERE cohort = v_cohort AND touch_number = 2 AND active = true
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'no_sequence_content_available');
    END IF;
  END IF;

  v_due_at := now() + (v_first_seq.day_offset || ' days')::interval;

  -- Create enrollment row
  INSERT INTO nurture_enrollments (
    staging_id, cohort, trigger_source, trigger_detail,
    enrolled_at, current_touch, next_touch_number, next_touch_due_at, status
  ) VALUES (
    p_staging_id, v_cohort, p_trigger_source, p_trigger_detail,
    now(), 1, 2, v_due_at, 'active'
  ) RETURNING id INTO v_enrollment_id;

  -- Stamp staging row
  UPDATE warm_outbound_staging
  SET nurture_trigger     = p_trigger_source,
      nurture_enrolled_at = now(),
      nurture_next_due_at = v_due_at,
      nurture_status      = 'active',
      nurture_started_at  = COALESCE(nurture_started_at, now())
  WHERE id = p_staging_id;

  RETURN jsonb_build_object(
    'ok', true,
    'enrollment_id', v_enrollment_id,
    'staging_id', p_staging_id,
    'cohort', v_cohort,
    'trigger_source', p_trigger_source,
    'next_touch_due_at', v_due_at
  );
END;
$$ LANGUAGE plpgsql;

-- Cancellation function — used when a lead replies mid-sequence or buys.
CREATE OR REPLACE FUNCTION cancel_nurture(
  p_staging_id bigint,
  p_reason text
) RETURNS jsonb AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE nurture_enrollments
  SET status = CASE
    WHEN p_reason ILIKE '%purchas%' OR p_reason = 'cancelled_purchased' THEN 'cancelled_purchased'
    WHEN p_reason ILIKE '%repl%' OR p_reason = 'cancelled_replied' THEN 'cancelled_replied'
    ELSE 'cancelled'
  END,
      cancelled_reason = p_reason,
      cancelled_at = now()
  WHERE staging_id = p_staging_id AND status = 'active';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    UPDATE warm_outbound_staging
    SET nurture_status = 'cancelled', nurture_next_due_at = NULL
    WHERE id = p_staging_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'cancelled_count', v_count, 'reason', p_reason);
END;
$$ LANGUAGE plpgsql;
