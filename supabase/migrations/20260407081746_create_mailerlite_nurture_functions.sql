
-- Function 1: Format lead data for MailerLite
CREATE OR REPLACE FUNCTION format_lead_for_mailerlite(
  p_email text,
  p_risk_level text DEFAULT NULL,
  p_case_file text DEFAULT NULL,
  p_session_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN jsonb_build_object(
    'email', p_email,
    'fields', jsonb_build_object(
      'risk_level', COALESCE(p_risk_level, 'unknown'),
      'case_file', COALESCE(p_case_file, 'unknown'),
      'session_id', COALESCE(p_session_id, ''),
      'source', 'lock_view_nurture'
    ),
    'groups', jsonb_build_array('181203426870298094')
  );
END;
$$;

-- Function 2: Trigger nurture on lock_view event
CREATE OR REPLACE FUNCTION trigger_nurture_on_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_email text;
  v_case_file text;
  v_risk_level text;
  v_payload jsonb;
BEGIN
  -- Only fire on lock_view events
  IF NEW.event_name != 'lock_view' THEN
    RETURN NEW;
  END IF;

  -- Look up email from leads table via session_id
  SELECT l.email, l.case_file, l.risk_level
  INTO v_email, v_case_file, v_risk_level
  FROM leads l
  WHERE l.session_id = NEW.session_id
  AND l.email IS NOT NULL
  AND l.email != ''
  LIMIT 1;

  -- Only proceed if we have an email
  IF v_email IS NULL THEN
    RETURN NEW;
  END IF;

  -- Build MailerLite payload
  v_payload := format_lead_for_mailerlite(v_email, v_risk_level, v_case_file, NEW.session_id);

  -- Push directly to MailerLite via pg_net
  PERFORM net.http_post(
    url := 'https://connect.mailerlite.com/api/subscribers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI0IiwianRpIjoiOTE0Nzc2Y2QzMWE1MTg5ZmQ1ZjMzMDExYTE3MjYwMmM5NmZkOTg5MDc3MDA2MzFlYzgyNjBjYjA5OTZmZTgwNGMwZTJiZDM0N2EwZWQzZjIiLCJpYXQiOjE3NzI4ODQyNzkuMjIxMzA4LCJuYmYiOjE3NzI4ODQyNzkuMjIxMzEyLCJleHAiOjQ5Mjg1NTc4NzkuMjExMTIzLCJzdWIiOiIyMTgzNjY1Iiwic2NvcGVzIjpbXX0.RLr170kV8fgmPK-BSK3LI5uXqf3efp4N_dvWGCD3jabbkDzdY6c6IpnrLXYC2RWW89pKWF3VkKHKprGI3kcKLByhCHOK5LH8a74I0P0dkXI7Of4HbYYqJpjAfqjCTteaZZECdDI5s-qQcgjNvpEIBMGUdeXOngwnrdj19PH102LnCo0MiOeckgggdf58fkK_F6bU0FNtTxpotXWkc3VFWyZeghxddNzBrHDC-mlvP4_sp46exdISi8cLG9WOThQkd_jtUalkqbu2KMPxhUXqZi--ccvJ4JJh2b8w93BYXKkBXtbx8o52HtOeLCQ5RNt9kqY4Sre9YZdW7FLErxUze_Z2dpnmpoLSwNBu9eHAhKcf5lixup74lUPiEN8wD2s40l8FLsDpMtqi4doRtu3KCig8ExGlhxmDYRrTNdBYhvxdPLZv3OU49Nrn9QaM1zKDqXnj1a81ojqoB8o1Sugg3Nqjo_4SSZacGRg0jSMrsB4A9Fb9ZsWRAkraeYsZJ8i0eWXR4B1kWdi4nSaFJle1OPBI4dS6ReSzmOzZvOnSJwgCuo7O2My_A8Nyu52Shb7nuxCXYTRrM-gyqhST_MO6SEST8-wwydcjljG3YSh5nuOihXSqyGqgPCaYrjGin5Fh5i75KyUy53gOWhy64o4U_qSkGukgHwF8-GMZ1j2cOD0'
    ),
    body := v_payload
  );

  RETURN NEW;
END;
$$;
