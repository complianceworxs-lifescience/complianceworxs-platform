
-- Drop the duplicate trigger (keep nurture_on_lockview, kill nurture_on_lock_view)
DROP TRIGGER IF EXISTS nurture_on_lock_view ON events;

-- Rewrite the function — no more MailerLite, no more hardcoded JWT
-- On lock_view: look up lead by session_id, push to lead-outreach-email (Attio sync)
CREATE OR REPLACE FUNCTION public.trigger_nurture_on_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email      text;
  v_name       text;
  v_company    text;
  v_title      text;
  v_case_file  text;
  v_source     text;
  v_page       text;
BEGIN
  -- Only fire on lock_view events
  IF NEW.event_name != 'lock_view' THEN
    RETURN NEW;
  END IF;

  -- Look up lead by session_id
  SELECT l.email, l.name, l.company, l.title, l.case_file, l.source, l.page
  INTO v_email, v_name, v_company, v_title, v_case_file, v_source, v_page
  FROM leads l
  WHERE l.session_id = NEW.session_id
    AND l.email IS NOT NULL
    AND l.email != ''
  LIMIT 1;

  -- No email on file — nothing to route
  IF v_email IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fire lead-outreach-email → syncs to Attio, creates outreach note
  PERFORM net.http_post(
    url     := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/lead-outreach-email',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object(
      'email',     v_email,
      'name',      v_name,
      'company',   v_company,
      'title',     v_title,
      'case_file', v_case_file,
      'source',    COALESCE(v_source, 'lock_view'),
      'page',      v_page
    )
  );

  RETURN NEW;
END;
$$;
