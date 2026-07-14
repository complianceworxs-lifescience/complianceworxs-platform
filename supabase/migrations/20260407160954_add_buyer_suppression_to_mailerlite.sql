
CREATE OR REPLACE FUNCTION suppress_buyer_in_mailerlite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_email text;
BEGIN
  -- Only fire on succeeded payment intents
  IF NEW.status != 'succeeded' THEN
    RETURN NEW;
  END IF;

  -- Extract email
  v_email := COALESCE(
    NEW.charges->'data'->0->'billing_details'->>'email',
    NEW._raw_data->>'receipt_email',
    NEW._raw_data->'metadata'->>'email'
  );

  IF v_email IS NULL OR v_email = '' THEN
    RETURN NEW;
  END IF;

  -- Add to CW_Suppression_Purchased group in MailerLite
  -- This stops all active nurture sequences for this subscriber
  PERFORM net.http_post(
    url := 'https://connect.mailerlite.com/api/subscribers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI0IiwianRpIjoiOTE0Nzc2Y2QzMWE1MTg5ZmQ1ZjMzMDExYTE3MjYwMmM5NmZkOTg5MDc3MDA2MzFlYzgyNjBjYjA5OTZmZTgwNGMwZTJiZDM0N2EwZWQzZjIiLCJpYXQiOjE3NzI4ODQyNzkuMjIxMzA4LCJuYmYiOjE3NzI4ODQyNzkuMjIxMzEyLCJleHAiOjQ5Mjg1NTc4NzkuMjExMTIzLCJzdWIiOiIyMTgzNjY1Iiwic2NvcGVzIjpbXX0.RLr170kV8fgmPK-BSK3LI5uXqf3efp4N_dvWGCD3jabbkDzdY6c6IpnrLXYC2RWW89pKWF3VkKHKprGI3kcKLByhCHOK5LH8a74I0P0dkXI7Of4HbYYqJpjAfqjCTteaZZECdDI5s-qQcgjNvpEIBMGUdeXOngwnrdj19PH102LnCo0MiOeckgggdf58fkK_F6bU0FNtTxpotXWkc3VFWyZeghxddNzBrHDC-mlvP4_sp46exdISi8cLG9WOThQkd_jtUalkqbu2KMPxhUXqZi--ccvJ4JJh2b8w93BYXKkBXtbx8o52HtOeLCQ5RNt9kqY4Sre9YZdW7FLErxUze_Z2dpnmpoLSwNBu9eHAhKcf5lixup74lUPiEN8wD2s40l8FLsDpMtqi4doRtu3KCig8ExGlhxmDYRrTNdBYhvxdPLZv3OU49Nrn9QaM1zKDqXnj1a81ojqoB8o1Sugg3Nqjo_4SSZacGRg0jSMrsB4A9Fb9ZsWRAkraeYsZJ8i0eWXR4B1kWdi4nSaFJle1OPBI4dS6ReSzmOzZvOnSJwgCuo7O2My_A8Nyu52Shb7nuxCXYTRrM-gyqhST_MO6SEST8-wwydcjljG3YSh5nuOihXSqyGqgPCaYrjGin5Fh5i75KyUy53gOWhy64o4U_qSkGukgHwF8-GMZ1j2cOD0'
    ),
    body := jsonb_build_object(
      'email', LOWER(v_email),
      'groups', jsonb_build_array('183721668625041237')
    )
  );

  RETURN NEW;
END;
$$;

-- Attach to stripe.payment_intents
DROP TRIGGER IF EXISTS suppress_buyer_on_payment ON stripe.payment_intents;

CREATE TRIGGER suppress_buyer_on_payment
  AFTER INSERT OR UPDATE ON stripe.payment_intents
  FOR EACH ROW
  EXECUTE FUNCTION suppress_buyer_in_mailerlite();
