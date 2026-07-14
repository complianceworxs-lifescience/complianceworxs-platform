
-- =============================================================================
-- Three signal triggers, one for each enrollment source.
-- =============================================================================

-- Signal 1: Manual DM reply flag set on warm_outbound_staging.dm_replied_at
CREATE OR REPLACE FUNCTION trg_nurture_on_dm_reply() RETURNS trigger AS $$
BEGIN
  IF NEW.dm_replied_at IS NOT NULL AND (OLD.dm_replied_at IS NULL OR OLD.dm_replied_at IS DISTINCT FROM NEW.dm_replied_at) THEN
    PERFORM enroll_in_nurture(NEW.id, 'manual_dm_reply', 'dm_replied_at flag set');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_warm_outbound_staging_nurture_dm ON warm_outbound_staging;
CREATE TRIGGER trg_warm_outbound_staging_nurture_dm
  AFTER UPDATE OF dm_replied_at ON warm_outbound_staging
  FOR EACH ROW EXECUTE FUNCTION trg_nurture_on_dm_reply();

-- Signal 2: Email reply classified by reply-classifier.
-- Enroll on positive / neutral / wrong_person.
-- Auto-cancel any existing nurture if classification is negative or unsubscribe (don't keep emailing them).
CREATE OR REPLACE FUNCTION trg_nurture_on_email_reply() RETURNS trigger AS $$
BEGIN
  -- Only fire when classification was just set
  IF NEW.classification IS NULL THEN RETURN NEW; END IF;
  IF OLD.classification = NEW.classification THEN RETURN NEW; END IF;
  IF NEW.staging_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.classification IN ('positive', 'neutral', 'wrong_person') THEN
    PERFORM enroll_in_nurture(NEW.staging_id, 'email_reply', 'classified as ' || NEW.classification);
  ELSIF NEW.classification IN ('negative', 'unsubscribe') THEN
    PERFORM cancel_nurture(NEW.staging_id, 'cancelled_replied:' || NEW.classification);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inbound_replies_nurture ON inbound_replies;
CREATE TRIGGER trg_inbound_replies_nurture
  AFTER UPDATE OF classification ON inbound_replies
  FOR EACH ROW EXECUTE FUNCTION trg_nurture_on_email_reply();

-- Signal 3: Tracked link click on a case file page.
-- Generic RPC that any source (PostHog webhook, server-side click logger, edge fn) can call.
-- We expose it as a public function so an edge fn can call it via service role.
CREATE OR REPLACE FUNCTION enroll_on_link_click(
  p_email text,
  p_url text,
  p_case_file_slug text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_staging_id bigint;
BEGIN
  IF p_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_email_provided');
  END IF;

  -- Find the most recent matching staging row
  SELECT id INTO v_staging_id
  FROM warm_outbound_staging
  WHERE lower(email) = lower(p_email)
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_staging_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'email_not_in_staging', 'email', p_email);
  END IF;

  -- If a case file slug came in via the click event, refine the cohort hint on the staging row
  -- (only if the row doesn't already have an interest set — preserve original targeting)
  IF p_case_file_slug IS NOT NULL THEN
    UPDATE warm_outbound_staging
    SET case_file_interest = COALESCE(case_file_interest, p_case_file_slug)
    WHERE id = v_staging_id;
  END IF;

  RETURN enroll_in_nurture(v_staging_id, 'link_click', 'url=' || COALESCE(p_url, 'unknown'));
END;
$$ LANGUAGE plpgsql;

-- Auto-cancel hook: when someone becomes a paying customer, stop the drip
CREATE OR REPLACE FUNCTION trg_nurture_on_purchase() RETURNS trigger AS $$
BEGIN
  IF NEW.is_paying_customer = true AND (OLD.is_paying_customer IS NULL OR OLD.is_paying_customer = false) THEN
    PERFORM cancel_nurture(NEW.id, 'cancelled_purchased');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_warm_outbound_staging_nurture_purchase ON warm_outbound_staging;
CREATE TRIGGER trg_warm_outbound_staging_nurture_purchase
  AFTER UPDATE OF is_paying_customer ON warm_outbound_staging
  FOR EACH ROW EXECUTE FUNCTION trg_nurture_on_purchase();
