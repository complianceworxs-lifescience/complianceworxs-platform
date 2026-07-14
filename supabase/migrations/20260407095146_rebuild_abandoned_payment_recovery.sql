
CREATE OR REPLACE FUNCTION recover_abandoned_payment_intents()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
  v_email text;
  v_payload jsonb;
BEGIN
  FOR rec IN
    SELECT id, amount, created, charges, _raw_data
    FROM stripe.payment_intents
    WHERE status IN ('requires_payment_method', 'requires_confirmation', 'requires_action', 'processing')
    AND to_timestamp(created) BETWEEN now() - INTERVAL '24 hours' AND now() - INTERVAL '1 hour'
  LOOP
    v_email := COALESCE(
      rec.charges->'data'->0->'billing_details'->>'email',
      rec._raw_data->>'receipt_email',
      rec._raw_data->'metadata'->>'email'
    );

    IF v_email IS NULL OR v_email = '' THEN CONTINUE; END IF;

    IF EXISTS (SELECT 1 FROM public.purchases WHERE email = v_email) THEN CONTINUE; END IF;

    IF EXISTS (SELECT 1 FROM public.outreach_log WHERE email = v_email AND trigger_reason = 'abandoned_payment') THEN CONTINUE; END IF;

    v_payload := jsonb_build_object(
      'email', v_email,
      'fields', jsonb_build_object(
        'source', 'abandoned_payment',
        'amount_cents', rec.amount,
        'payment_intent_id', rec.id
      ),
      'groups', jsonb_build_array('181203426870298094')
    );

    PERFORM net.http_post(
      url := 'https://connect.mailerlite.com/api/subscribers',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI0IiwianRpIjoiOTE0Nzc2Y2QzMWE1MTg5ZmQ1ZjMzMDExYTE3MjYwMmM5NmZkOTg5MDc3MDA2MzFlYzgyNjBjYjA5OTZmZTgwNGMwZTJiZDM0N2EwZWQzZjIiLCJpYXQiOjE3NzI4ODQyNzkuMjIxMzA4LCJuYmYiOjE3NzI4ODQyNzkuMjIxMzEyLCJleHAiOjQ5Mjg1NTc4NzkuMjExMTIzLCJzdWIiOiIyMTgzNjY1Iiwic2NvcGVzIjpbXX0.RLr170kV8fgmPK-BSK3LI5uXqf3efp4N_dvWGCD3jabbkDzdY6c6IpnrLXYC2RWW89pKWF3VkKHKprGI3kcKLByhCHOK5LH8a74I0P0dkXI7Of4HbYYqJpjAfqjCTteaZZECdDI5s-qQcgjNvpEIBMGUdeXOngwnrdj19PH102LnCo0MiOeckgggdf58fkK_F6bU0FNtTxpotXWkc3VFWyZeghxddNzBrHDC-mlvP4_sp46exdISi8cLG9WOThQkd_jtUalkqbu2KMPxhUXqZi--ccvJ4JJh2b8w93BYXKkBXtbx8o52HtOeLCQ5RNt9kqY4Sre9YZdW7FLErxUze_Z2dpnmpoLSwNBu9eHAhKcf5lixup74lUPiEN8wD2s40l8FLsDpMtqi4doRtu3KCig8ExGlhxmDYRrTNdBYhvxdPLZv3OU49Nrn9QaM1zKDqXnj1a81ojqoB8o1Sugg3Nqjo_4SSZacGRg0jSMrsB4A9Fb9ZsWRAkraeYsZJ8i0eWXR4B1kWdi4nSaFJle1OPBI4dS6ReSzmOzZvOnSJwgCuo7O2My_A8Nyu52Shb7nuxCXYTRrM-gyqhST_MO6SEST8-wwydcjljG3YSh5nuOihXSqyGqgPCaYrjGin5Fh5i75KyUy53gOWhy64o4U_qSkGukgHwF8-GMZ1j2cOD0'
      ),
      body := v_payload
    );

    INSERT INTO public.outreach_log (email, trigger_reason, result, subject)
    VALUES (v_email, 'abandoned_payment', 'sent', 'Abandoned payment recovery')
    ON CONFLICT DO NOTHING;

  END LOOP;
END;
$$;

SELECT cron.schedule(
  'abandoned-payment-recovery',
  '0 * * * *',
  'SELECT recover_abandoned_payment_intents();'
);
