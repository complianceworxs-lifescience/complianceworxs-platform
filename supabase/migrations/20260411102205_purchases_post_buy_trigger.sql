
-- On purchase: update contact lifecycle to customer + fire Apollo enrich if not yet enriched
CREATE OR REPLACE FUNCTION trigger_post_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contact_id      uuid;
  v_attio_person_id text;
  v_full_name       text;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  -- Update contact lifecycle to customer
  UPDATE contacts
  SET lifecycle_stage = 'customer',
      updated_at      = now()
  WHERE normalized_email = lower(trim(NEW.email))
  RETURNING id, attio_person_id, full_name
  INTO v_contact_id, v_attio_person_id, v_full_name;

  -- Fire Apollo enrich if contact not yet enriched
  IF v_contact_id IS NOT NULL AND v_full_name IS NULL THEN
    PERFORM net.http_post(
      url     := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/apollo-enrich',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object(
        'email',           NEW.email,
        'attio_record_id', v_attio_person_id
      )
    );
  END IF;

  -- Push to lead-outreach-email so Attio record is updated to buyer stage
  PERFORM net.http_post(
    url     := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/lead-outreach-email',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object(
      'email',     NEW.email,
      'source',    'purchase',
      'case_file', NEW.case_file,
      'page',      COALESCE(NEW.case_file_id, NEW.case_file)
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS purchases_post_buy ON purchases;
CREATE TRIGGER purchases_post_buy
  AFTER INSERT ON purchases
  FOR EACH ROW
  EXECUTE FUNCTION trigger_post_purchase();
