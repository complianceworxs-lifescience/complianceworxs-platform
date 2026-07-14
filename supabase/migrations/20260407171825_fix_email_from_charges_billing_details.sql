
CREATE OR REPLACE FUNCTION sync_stripe_payment_to_purchases()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_email text;
  v_name text;
  v_amount int;
  v_case_file text;
  v_case_file_id text;
BEGIN
  IF NEW.status != 'succeeded' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.purchases WHERE stripe_session_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Pull email from charges.billing_details (most reliable for Stripe Link)
  SELECT 
    c.billing_details->>'email',
    c.billing_details->>'name'
  INTO v_email, v_name
  FROM stripe.charges c
  WHERE c.payment_intent = NEW.id
  LIMIT 1;

  -- Fallback: receipt_email on charges
  IF v_email IS NULL OR v_email = '' THEN
    SELECT c.receipt_email INTO v_email
    FROM stripe.charges c
    WHERE c.payment_intent = NEW.id
    LIMIT 1;
  END IF;

  -- Fallback: checkout_sessions customer_email
  IF v_email IS NULL OR v_email = '' THEN
    SELECT cs.customer_email INTO v_email
    FROM stripe.checkout_sessions cs
    WHERE cs.payment_intent = NEW.id
    LIMIT 1;
  END IF;

  -- Fallback: raw data
  IF v_email IS NULL OR v_email = '' THEN
    v_email := NEW._raw_data->>'receipt_email';
  END IF;

  v_amount := NEW.amount;

  v_case_file_id := CASE
    WHEN v_amount = 2700  THEN 'DAM'
    WHEN v_amount = 29700 THEN 'BUNDLE'
    WHEN v_amount = 14900 THEN 'CF-UNKNOWN'
    ELSE 'CF-' || v_amount::text
  END;

  v_case_file := CASE
    WHEN v_amount = 2700  THEN 'Decision Authority Matrix — $27'
    WHEN v_amount = 29700 THEN 'Complete Authorization Package — $297'
    WHEN v_amount = 14900 THEN 'Case File — $149'
    ELSE 'Unknown — $' || (v_amount / 100)
  END;

  INSERT INTO public.purchases (
    email,
    name,
    case_file,
    case_file_id,
    stripe_session_id,
    purchased_at
  ) VALUES (
    COALESCE(LOWER(v_email), 'unknown'),
    v_name,
    v_case_file,
    v_case_file_id,
    NEW.id,
    to_timestamp(NEW.created)
  )
  ON CONFLICT (stripe_session_id) DO NOTHING;

  IF v_email IS NOT NULL AND v_email != '' THEN
    UPDATE public.leads
    SET is_buyer = true, converted_at = now()
    WHERE LOWER(email) = LOWER(v_email);

    -- Suppress from nurture sequences
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
  END IF;

  RETURN NEW;
END;
$$;
