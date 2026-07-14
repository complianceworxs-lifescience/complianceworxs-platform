
-- Fix: don't write to case_file_interest until we know we're going to enroll.
-- Check active enrollment FIRST. If already enrolled, log the click and bail
-- without mutating the staging row.
CREATE OR REPLACE FUNCTION enroll_from_link_click(
  p_email     text,
  p_page_url  text,
  p_user_agent text DEFAULT NULL,
  p_ip_address text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_staging_id    bigint;
  v_slug          text;
  v_mapped_cohort text;
  v_lead          RECORD;
  v_enroll_result jsonb;
  v_log_id        bigint;
  v_result_label  text;
  v_enrollment_id bigint;
  v_existing_active bigint;
BEGIN
  IF p_email IS NULL OR p_email = '' THEN
    INSERT INTO nurture_link_click_log (email, page_url, result, result_detail, user_agent, ip_address)
    VALUES (p_email, p_page_url, 'error',
            jsonb_build_object('error', 'no_email_provided'),
            p_user_agent, p_ip_address);
    RETURN jsonb_build_object('ok', false, 'reason', 'no_email_provided');
  END IF;

  v_slug := extract_case_file_slug(p_page_url);

  IF v_slug IS NOT NULL THEN
    SELECT cohort INTO v_mapped_cohort FROM case_file_cohort_map WHERE page_slug = v_slug;
  END IF;

  SELECT id, full_name, email, case_file_interest, target_account_priority,
         is_paying_customer, automation_paused
    INTO v_lead
  FROM warm_outbound_staging
  WHERE lower(email) = lower(p_email)
  ORDER BY id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO nurture_link_click_log (email, page_url, page_slug, result, result_detail, user_agent, ip_address)
    VALUES (p_email, p_page_url, v_slug, 'no_staging_match',
            jsonb_build_object('email', p_email),
            p_user_agent, p_ip_address);
    RETURN jsonb_build_object('ok', false, 'reason', 'no_staging_match', 'email', p_email);
  END IF;

  v_staging_id := v_lead.id;

  IF v_lead.is_paying_customer THEN
    INSERT INTO nurture_link_click_log (email, page_url, page_slug, staging_id, result, result_detail, user_agent, ip_address)
    VALUES (p_email, p_page_url, v_slug, v_staging_id, 'is_paying_customer',
            jsonb_build_object('staging_id', v_staging_id),
            p_user_agent, p_ip_address);
    RETURN jsonb_build_object('ok', false, 'reason', 'is_paying_customer', 'staging_id', v_staging_id);
  END IF;

  -- CHECK FOR ACTIVE ENROLLMENT FIRST (before mutating anything)
  SELECT id INTO v_existing_active
  FROM nurture_enrollments
  WHERE staging_id = v_staging_id AND status = 'active'
  LIMIT 1;

  IF v_existing_active IS NOT NULL THEN
    INSERT INTO nurture_link_click_log
      (email, page_url, page_slug, staging_id, enrollment_id, result, result_detail, user_agent, ip_address)
    VALUES
      (p_email, p_page_url, v_slug, v_staging_id, v_existing_active, 'already_enrolled',
       jsonb_build_object('enrollment_id', v_existing_active, 'reason', 'already_enrolled'),
       p_user_agent, p_ip_address)
    RETURNING id INTO v_log_id;

    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'already_enrolled',
      'enrollment_id', v_existing_active,
      'staging_id', v_staging_id,
      'page_slug', v_slug,
      'log_id', v_log_id
    );
  END IF;

  -- Only NOW write the case_file_interest, since we know we're proceeding to enroll
  IF v_mapped_cohort IS NOT NULL THEN
    UPDATE warm_outbound_staging
    SET case_file_interest = v_mapped_cohort
    WHERE id = v_staging_id;
  END IF;

  v_enroll_result := enroll_in_nurture(
    v_staging_id,
    'link_click',
    'clicked: ' || COALESCE(p_page_url, '(no url)')
  );

  IF (v_enroll_result->>'ok')::boolean THEN
    v_result_label := 'enrolled';
    v_enrollment_id := (v_enroll_result->>'enrollment_id')::bigint;
  ELSIF v_enroll_result->>'reason' = 'suppressed' THEN
    v_result_label := 'suppressed';
  ELSIF v_enroll_result->>'reason' = 'already_customer' THEN
    v_result_label := 'is_paying_customer';
  ELSE
    v_result_label := 'error';
  END IF;

  INSERT INTO nurture_link_click_log
    (email, page_url, page_slug, staging_id, enrollment_id, result, result_detail, user_agent, ip_address)
  VALUES
    (p_email, p_page_url, v_slug, v_staging_id, v_enrollment_id, v_result_label, v_enroll_result, p_user_agent, p_ip_address)
  RETURNING id INTO v_log_id;

  RETURN v_enroll_result || jsonb_build_object(
    'log_id', v_log_id,
    'staging_id', v_staging_id,
    'page_slug', v_slug,
    'mapped_cohort', v_mapped_cohort
  );
END;
$$ LANGUAGE plpgsql;
