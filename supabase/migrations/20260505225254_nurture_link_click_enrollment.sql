
-- =============================================================================
-- Link-click nurture enrollment (May 5 2026)
--
-- Resolves an email + page URL to a staging row and enrolls into nurture.
-- Cohort selection: first try the page URL slug (e.g. "batch-release-authorization"),
-- then fall back to staging row's case_file_interest / target_account_priority,
-- then universal.
--
-- Also adds an audit table so we can see every click that came in,
-- regardless of whether it triggered enrollment.
-- =============================================================================

-- 1. Audit table for incoming link clicks
CREATE TABLE IF NOT EXISTS nurture_link_click_log (
  id              bigserial PRIMARY KEY,
  email           text,
  page_url        text,
  page_slug       text,                  -- normalized slug pulled from page_url
  staging_id      bigint REFERENCES warm_outbound_staging(id) ON DELETE SET NULL,
  enrollment_id   bigint REFERENCES nurture_enrollments(id) ON DELETE SET NULL,
  result          text,                  -- 'enrolled' | 'already_enrolled' | 'no_staging_match' | 'suppressed' | 'is_paying_customer' | 'error'
  result_detail   jsonb,
  user_agent      text,
  ip_address      text,
  received_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nurture_link_click_log_email
  ON nurture_link_click_log (email);
CREATE INDEX IF NOT EXISTS idx_nurture_link_click_log_received
  ON nurture_link_click_log (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_nurture_link_click_log_result
  ON nurture_link_click_log (result, received_at DESC);

-- 2. Helper: extract the case-file slug from a complianceworxs URL
CREATE OR REPLACE FUNCTION extract_case_file_slug(p_url text)
RETURNS text AS $$
DECLARE
  v_slug text;
BEGIN
  IF p_url IS NULL OR p_url = '' THEN
    RETURN NULL;
  END IF;

  -- Match cases.complianceworxs.com/<slug> or complianceworxs.com/<slug>
  -- Pull the first path segment after the host.
  v_slug := lower(regexp_replace(
    p_url,
    '^https?://[^/]*complianceworxs\.com/([a-z0-9\-]+).*$',
    '\1',
    'i'
  ));

  -- If regex didn't match (returned the whole URL), give up
  IF v_slug = lower(p_url) OR v_slug = '' THEN
    RETURN NULL;
  END IF;

  RETURN v_slug;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. Main enrollment function for link clicks
CREATE OR REPLACE FUNCTION enroll_from_link_click(
  p_email     text,
  p_page_url  text,
  p_user_agent text DEFAULT NULL,
  p_ip_address text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_staging_id   bigint;
  v_slug         text;
  v_lead         RECORD;
  v_enroll_result jsonb;
  v_log_id       bigint;
  v_result_label text;
  v_enrollment_id bigint;
BEGIN
  -- Normalize inputs
  IF p_email IS NULL OR p_email = '' THEN
    INSERT INTO nurture_link_click_log (email, page_url, result, result_detail, user_agent, ip_address)
    VALUES (p_email, p_page_url, 'error',
            jsonb_build_object('error', 'no_email_provided'),
            p_user_agent, p_ip_address);
    RETURN jsonb_build_object('ok', false, 'reason', 'no_email_provided');
  END IF;

  v_slug := extract_case_file_slug(p_page_url);

  -- Find the staging row (case-insensitive email match)
  SELECT id, full_name, email, case_file_interest, target_account_priority,
         is_paying_customer, automation_paused
    INTO v_lead
  FROM warm_outbound_staging
  WHERE lower(email) = lower(p_email)
  ORDER BY id DESC  -- prefer most recent if duplicates
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO nurture_link_click_log (email, page_url, page_slug, result, result_detail, user_agent, ip_address)
    VALUES (p_email, p_page_url, v_slug, 'no_staging_match',
            jsonb_build_object('email', p_email),
            p_user_agent, p_ip_address);
    RETURN jsonb_build_object('ok', false, 'reason', 'no_staging_match', 'email', p_email);
  END IF;

  v_staging_id := v_lead.id;

  -- If clicker is already a paying customer, log it (could be a buyer revisiting)
  IF v_lead.is_paying_customer THEN
    INSERT INTO nurture_link_click_log (email, page_url, page_slug, staging_id, result, result_detail, user_agent, ip_address)
    VALUES (p_email, p_page_url, v_slug, v_staging_id, 'is_paying_customer',
            jsonb_build_object('staging_id', v_staging_id),
            p_user_agent, p_ip_address);
    RETURN jsonb_build_object('ok', false, 'reason', 'is_paying_customer', 'staging_id', v_staging_id);
  END IF;

  -- If we have a slug from the URL, write it to case_file_interest BEFORE
  -- enroll_in_nurture runs. resolve_nurture_cohort uses case_file_interest first,
  -- so this gets us the right cohort even if their original lead record didn't have one.
  IF v_slug IS NOT NULL AND (v_lead.case_file_interest IS NULL OR v_lead.case_file_interest = '') THEN
    UPDATE warm_outbound_staging
    SET case_file_interest = v_slug
    WHERE id = v_staging_id;
  END IF;

  -- Call the existing enroll_in_nurture function. It handles all the safety checks
  -- (already enrolled, suppressed, paused, etc.) and cohort resolution.
  v_enroll_result := enroll_in_nurture(
    v_staging_id,
    'link_click',
    'clicked: ' || COALESCE(p_page_url, '(no url)')
  );

  -- Determine result label for the audit log
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

  -- Always log the click attempt
  INSERT INTO nurture_link_click_log
    (email, page_url, page_slug, staging_id, enrollment_id, result, result_detail, user_agent, ip_address)
  VALUES
    (p_email, p_page_url, v_slug, v_staging_id, v_enrollment_id, v_result_label, v_enroll_result, p_user_agent, p_ip_address)
  RETURNING id INTO v_log_id;

  RETURN v_enroll_result || jsonb_build_object(
    'log_id', v_log_id,
    'staging_id', v_staging_id,
    'page_slug', v_slug
  );
END;
$$ LANGUAGE plpgsql;

-- 4. Helpful view: yesterday's click activity
CREATE OR REPLACE VIEW nurture_link_clicks_recent AS
SELECT
  l.id, l.email, l.page_slug, l.result, l.received_at,
  l.staging_id, l.enrollment_id,
  s.full_name, s.company,
  ne.cohort, ne.next_touch_due_at
FROM nurture_link_click_log l
LEFT JOIN warm_outbound_staging s ON s.id = l.staging_id
LEFT JOIN nurture_enrollments ne ON ne.id = l.enrollment_id
WHERE l.received_at > now() - interval '7 days'
ORDER BY l.received_at DESC;
