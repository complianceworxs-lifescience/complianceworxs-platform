
-- On lead_intents UPDATE: fire when assessment_completed or lock_viewed flip to TRUE
CREATE OR REPLACE FUNCTION trigger_lead_intent_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email           text;
  v_attio_person_id text;
BEGIN

  -- assessment_completed just flipped TRUE
  IF (NEW.assessment_completed = true AND OLD.assessment_completed = false) THEN
    SELECT c.email, c.attio_person_id
    INTO v_email, v_attio_person_id
    FROM contacts c
    WHERE c.id = NEW.contact_id
    LIMIT 1;

    IF v_email IS NOT NULL THEN
      -- Route to lead-outreach-email → Attio sync with assessment source
      PERFORM net.http_post(
        url     := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/lead-outreach-email',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body    := jsonb_build_object(
          'email',  v_email,
          'source', 'assessment_completed'
        )
      );

      -- Apollo enrich if not yet done
      PERFORM net.http_post(
        url     := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/apollo-enrich',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body    := jsonb_build_object(
          'email',           v_email,
          'attio_record_id', v_attio_person_id
        )
      );
    END IF;
  END IF;

  -- lock_viewed just flipped TRUE
  IF (NEW.lock_viewed = true AND OLD.lock_viewed = false) THEN
    SELECT c.email, c.attio_person_id
    INTO v_email, v_attio_person_id
    FROM contacts c
    WHERE c.id = NEW.contact_id
    LIMIT 1;

    IF v_email IS NOT NULL THEN
      PERFORM net.http_post(
        url     := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/lead-outreach-email',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body    := jsonb_build_object(
          'email',  v_email,
          'source', 'lock_viewed'
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lead_intents_state_change ON lead_intents;
CREATE TRIGGER lead_intents_state_change
  AFTER UPDATE ON lead_intents
  FOR EACH ROW
  EXECUTE FUNCTION trigger_lead_intent_state();
