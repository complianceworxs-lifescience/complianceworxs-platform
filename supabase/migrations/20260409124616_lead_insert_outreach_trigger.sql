
CREATE OR REPLACE FUNCTION trigger_lead_outreach_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  function_url text;
  service_key  text;
BEGIN
  function_url := current_setting('app.supabase_url', true)
    || '/functions/v1/lead-outreach-email';

  -- Fall back to hardcoded project URL if setting not present
  IF function_url IS NULL OR function_url = '/functions/v1/lead-outreach-email' THEN
    function_url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/lead-outreach-email';
  END IF;

  service_key := current_setting('app.service_role_key', true);

  PERFORM net.http_post(
    url     := function_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || COALESCE(service_key, '')
    ),
    body    := jsonb_build_object(
      'type',   'INSERT',
      'record', jsonb_build_object(
        'id',         NEW.id,
        'email',      NEW.email,
        'source',     NEW.source,
        'page',       NEW.page,
        'company',    NEW.company,
        'first_name', NEW.first_name,
        'utm_source', NEW.utm_source,
        'created_at', NEW.created_at
      )
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_lead_insert_send_email ON leads;

CREATE TRIGGER on_lead_insert_send_email
  AFTER INSERT ON leads
  FOR EACH ROW
  EXECUTE FUNCTION trigger_lead_outreach_email();
