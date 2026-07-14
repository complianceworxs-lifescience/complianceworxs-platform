
-- Function: sync successful Stripe payment intents to purchases table
CREATE OR REPLACE FUNCTION sync_stripe_payment_to_purchases()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_email text;
  v_amount int;
  v_case_file text;
  v_case_file_id text;
BEGIN
  -- Only process succeeded payment intents
  IF NEW.status != 'succeeded' THEN
    RETURN NEW;
  END IF;

  -- Skip if already recorded
  IF EXISTS (SELECT 1 FROM public.purchases WHERE stripe_session_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Extract email from charges jsonb
  v_email := COALESCE(
    NEW.charges->'data'->0->'billing_details'->>'email',
    NEW._raw_data->>'receipt_email',
    NEW._raw_data->'metadata'->>'email',
    'unknown'
  );

  v_amount := NEW.amount;

  -- Map amount to product
  v_case_file_id := CASE
    WHEN v_amount = 14900 THEN 'CF-UNKNOWN'
    WHEN v_amount = 2700  THEN 'DAM-27'
    ELSE 'CF-UNKNOWN'
  END;

  v_case_file := CASE
    WHEN v_amount = 14900 THEN 'Case File — $149'
    WHEN v_amount = 2700  THEN 'Decision Authority Matrix — $27'
    ELSE 'Unknown — $' || (v_amount / 100)
  END;

  -- Insert into purchases
  INSERT INTO public.purchases (
    email,
    case_file,
    case_file_id,
    stripe_session_id,
    purchased_at
  ) VALUES (
    v_email,
    v_case_file,
    v_case_file_id,
    NEW.id,
    to_timestamp(NEW.created)
  )
  ON CONFLICT (stripe_session_id) DO NOTHING;

  -- Update leads table if email known
  IF v_email != 'unknown' THEN
    UPDATE public.leads
    SET is_buyer = true,
        converted_at = now()
    WHERE email = v_email;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger on stripe.payment_intents
DROP TRIGGER IF EXISTS on_stripe_payment_succeeded ON stripe.payment_intents;

CREATE TRIGGER on_stripe_payment_succeeded
  AFTER INSERT OR UPDATE ON stripe.payment_intents
  FOR EACH ROW
  EXECUTE FUNCTION sync_stripe_payment_to_purchases();
