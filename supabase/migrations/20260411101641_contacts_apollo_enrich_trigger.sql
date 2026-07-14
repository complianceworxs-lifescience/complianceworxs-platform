
-- Trigger function: fires apollo-enrich edge function on new contact insert
CREATE OR REPLACE FUNCTION trigger_apollo_enrich()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only fire if email is present
  IF NEW.email IS NOT NULL THEN
    PERFORM pg_net.http_post(
      url     := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/apollo-enrich',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object(
        'email',           NEW.email,
        'attio_record_id', NEW.attio_person_id
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Attach to contacts INSERT
DROP TRIGGER IF EXISTS contacts_apollo_enrich ON contacts;
CREATE TRIGGER contacts_apollo_enrich
  AFTER INSERT ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION trigger_apollo_enrich();
