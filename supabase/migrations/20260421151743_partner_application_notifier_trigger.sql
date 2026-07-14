CREATE OR REPLACE FUNCTION public.notify_partner_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  function_url text := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/partner-application-notifier';
  payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'record', to_jsonb(NEW)
  );

  PERFORM net.http_post(
    url := function_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := payload
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_partner_application ON public.partner_applications;

CREATE TRIGGER trg_notify_partner_application
AFTER INSERT ON public.partner_applications
FOR EACH ROW
EXECUTE FUNCTION public.notify_partner_application();