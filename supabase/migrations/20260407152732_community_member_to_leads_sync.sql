
-- Sync community members to leads on join or update
CREATE OR REPLACE FUNCTION sync_community_member_to_leads()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.email IS NULL OR NEW.email = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.leads (
    email,
    name,
    title,
    company,
    source,
    session_id
  ) VALUES (
    LOWER(NEW.email),
    NEW.name,
    NEW.title,
    NEW.company,
    'community_member',
    'tir_' || NEW.id::text
  )
  ON CONFLICT (email) DO UPDATE SET
    name    = COALESCE(EXCLUDED.name, leads.name),
    title   = COALESCE(EXCLUDED.title, leads.title),
    company = COALESCE(EXCLUDED.company, leads.company),
    source  = 'community_member';

  -- Push to MailerLite with community group tag
  PERFORM net.http_post(
    url := 'https://connect.mailerlite.com/api/subscribers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI0IiwianRpIjoiOTE0Nzc2Y2QzMWE1MTg5ZmQ1ZjMzMDExYTE3MjYwMmM5NmZkOTg5MDc3MDA2MzFlYzgyNjBjYjA5OTZmZTgwNGMwZTJiZDM0N2EwZWQzZjIiLCJpYXQiOjE3NzI4ODQyNzkuMjIxMzA4LCJuYmYiOjE3NzI4ODQyNzkuMjIxMzEyLCJleHAiOjQ5Mjg1NTc4NzkuMjExMTIzLCJzdWIiOiIyMTgzNjY1Iiwic2NvcGVzIjpbXX0.RLr170kV8fgmPK-BSK3LI5uXqf3efp4N_dvWGCD3jabbkDzdY6c6IpnrLXYC2RWW89pKWF3VkKHKprGI3kcKLByhCHOK5LH8a74I0P0dkXI7Of4HbYYqJpjAfqjCTteaZZECdDI5s-qQcgjNvpEIBMGUdeXOngwnrdj19PH102LnCo0MiOeckgggdf58fkK_F6bU0FNtTxpotXWkc3VFWyZeghxddNzBrHDC-mlvP4_sp46exdISi8cLG9WOThQkd_jtUalkqbu2KMPxhUXqZi--ccvJ4JJh2b8w93BYXKkBXtbx8o52HtOeLCQ5RNt9kqY4Sre9YZdW7FLErxUze_Z2dpnmpoLSwNBu9eHAhKcf5lixup74lUPiEN8wD2s40l8FLsDpMtqi4doRtu3KCig8ExGlhxmDYRrTNdBYhvxdPLZv3OU49Nrn9QaM1zKDqXnj1a81ojqoB8o1Sugg3Nqjo_4SSZacGRg0jSMrsB4A9Fb9ZsWRAkraeYsZJ8i0eWXR4B1kWdi4nSaFJle1OPBI4dS6ReSzmOzZvOnSJwgCuo7O2My_A8Nyu52Shb7nuxCXYTRrM-gyqhST_MO6SEST8-wwydcjljG3YSh5nuOihXSqyGqgPCaYrjGin5Fh5i75KyUy53gOWhy64o4U_qSkGukgHwF8-GMZ1j2cOD0'
    ),
    body := jsonb_build_object(
      'email', LOWER(NEW.email),
      'fields', jsonb_build_object(
        'name', NEW.name,
        'company', NEW.company,
        'title', NEW.title,
        'source', 'community_member'
      ),
      'groups', jsonb_build_array('181203426870298094')
    )
  );

  RETURN NEW;
END;
$$;

-- Trigger on community_members insert or update
DROP TRIGGER IF EXISTS on_community_member_join ON community_members;

CREATE TRIGGER on_community_member_join
  AFTER INSERT OR UPDATE ON community_members
  FOR EACH ROW
  EXECUTE FUNCTION sync_community_member_to_leads();

-- Function: flag high-value members for enterprise outreach
CREATE OR REPLACE FUNCTION flag_enterprise_community_members()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT cm.email, cm.name, cm.title, cm.company, cm.linkedin_url, cm.joined_at
    FROM community_members cm
    WHERE cm.email IS NOT NULL
    AND (
      cm.title ILIKE '%director%' OR
      cm.title ILIKE '%vp%' OR
      cm.title ILIKE '%vice president%' OR
      cm.title ILIKE '%head of%' OR
      cm.title ILIKE '%chief%' OR
      cm.title ILIKE '%president%' OR
      cm.title ILIKE '%svp%' OR
      cm.title ILIKE '%evp%'
    )
    AND cm.email NOT IN (
      SELECT email FROM purchases WHERE email IS NOT NULL
    )
  LOOP
    INSERT INTO public.outreach_queue (
      email,
      trigger_reason,
      status,
      queued_at
    ) VALUES (
      rec.email,
      'enterprise_community_member',
      'pending',
      now()
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

-- Run enterprise flagging daily at 6am UTC
SELECT cron.schedule(
  'flag-enterprise-community-members',
  '0 6 * * *',
  'SELECT flag_enterprise_community_members();'
);
