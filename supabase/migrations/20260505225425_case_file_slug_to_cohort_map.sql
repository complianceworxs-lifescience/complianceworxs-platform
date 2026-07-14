
-- Lookup table: page slug → cohort name. Avoids fuzzy regex matching.
-- Edit rows here to control which page maps to which sequence.
CREATE TABLE IF NOT EXISTS case_file_cohort_map (
  page_slug   text PRIMARY KEY,
  cohort      text NOT NULL,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO case_file_cohort_map (page_slug, cohort, notes) VALUES
  ('batch-release-authorization',                  'batch_release_cohort',           'CF02'),
  ('capa-effectiveness',                            'capa_effectiveness_cohort',      'CF01'),
  ('change-control-risk-assessment-documentation',  'change_control_cohort',          'CF03'),
  ('deviation-risk-classification',                 'deviation_risk_cohort',          'CF04'),
  ('data-integrity-investigation-closure',          'data_integrity_cohort',          'CF05'),
  ('complaint-investigation-disposition',           'complaint_investigation_cohort', 'CF06'),
  ('supplier-qualification-exception',              'supplier_qualification_cohort',  'CF07')
ON CONFLICT (page_slug) DO UPDATE SET cohort = EXCLUDED.cohort;

-- Update enroll_from_link_click: when we have a slug, write the resolved cohort
-- name to case_file_interest so resolve_nurture_cohort matches exactly.
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
  v_existing_cfi  text;
BEGIN
  IF p_email IS NULL OR p_email = '' THEN
    INSERT INTO nurture_link_click_log (email, page_url, result, result_detail, user_agent, ip_address)
    VALUES (p_email, p_page_url, 'error',
            jsonb_build_object('error', 'no_email_provided'),
            p_user_agent, p_ip_address);
    RETURN jsonb_build_object('ok', false, 'reason', 'no_email_provided');
  END IF;

  v_slug := extract_case_file_slug(p_page_url);

  -- Look up cohort directly from the map (avoids fuzzy matching pitfalls)
  IF v_slug IS NOT NULL THEN
    SELECT cohort INTO v_mapped_cohort FROM case_file_cohort_map WHERE page_slug = v_slug;
  END IF;

  -- Find the staging row
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
  v_existing_cfi := v_lead.case_file_interest;

  IF v_lead.is_paying_customer THEN
    INSERT INTO nurture_link_click_log (email, page_url, page_slug, staging_id, result, result_detail, user_agent, ip_address)
    VALUES (p_email, p_page_url, v_slug, v_staging_id, 'is_paying_customer',
            jsonb_build_object('staging_id', v_staging_id),
            p_user_agent, p_ip_address);
    RETURN jsonb_build_object('ok', false, 'reason', 'is_paying_customer', 'staging_id', v_staging_id);
  END IF;

  -- Override case_file_interest with the mapped cohort name so resolve_nurture_cohort
  -- matches it exactly. Only do this if either (a) lead has no case_file_interest,
  -- or (b) the URL is more specific than what they had.
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
  ELSIF v_enroll_result->>'reason' = 'already_enrolled' THEN
    v_result_label := 'already_enrolled';
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
