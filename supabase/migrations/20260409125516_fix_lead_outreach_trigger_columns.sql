
CREATE OR REPLACE FUNCTION trigger_lead_outreach_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/lead-outreach-email',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'type',   'INSERT',
      'record', jsonb_build_object(
        'id',         NEW.id,
        'email',      NEW.email,
        'source',     NEW.source,
        'page',       NEW.page,
        'company',    NEW.company,
        'first_name', split_part(COALESCE(NEW.name, ''), ' ', 1),
        'utm_source', NEW.utm_source,
        'created_at', NEW.created_at
      )
    )
  );
  RETURN NEW;
END;
$$;
