
CREATE OR REPLACE FUNCTION trigger_apollo_enrich()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    PERFORM net.http_post(
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
