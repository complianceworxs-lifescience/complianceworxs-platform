-- Atomic budget check + reservation. Serializes concurrent senders with an advisory lock.
-- Returns true if the lead is allowed to send (and reserves a slot by inserting a placeholder),
-- false if the budget is exhausted or the lead would exceed cap.
--
-- The lock is keyed to the calendar day so concurrent calls block each other only within the same day.

CREATE OR REPLACE FUNCTION public.try_reserve_send_slot(p_staging_id BIGINT)
RETURNS TABLE(allowed BOOLEAN, reason TEXT, current_count INT, budget INT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_lock_key BIGINT;
  v_budget INT;
  v_current_count INT;
  v_already_dispatched BOOLEAN;
BEGIN
  -- Hash today's date into a 64-bit advisory lock key. All concurrent calls today block each other here.
  v_lock_key := abs(hashtext(CURRENT_DATE::text))::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Has this lead already been dispatched? (idempotency guard)
  SELECT (dispatched_at IS NOT NULL) INTO v_already_dispatched
  FROM warm_outbound_staging WHERE id = p_staging_id;

  IF v_already_dispatched THEN
    RETURN QUERY SELECT false, 'already_dispatched'::TEXT, 0, 0;
    RETURN;
  END IF;

  -- Get today's budget
  SELECT daily_budget INTO v_budget
  FROM outbound_send_budget_schedule
  WHERE effective_date <= CURRENT_DATE
  ORDER BY effective_date DESC LIMIT 1;
  v_budget := COALESCE(v_budget, 25);

  -- Count actual sends in last 24h (using send_provider='resend' as the canonical "real send" marker)
  SELECT COUNT(*) INTO v_current_count
  FROM warm_outbound_staging
  WHERE send_provider = 'resend'
    AND dispatched_at > NOW() - interval '24 hours';

  IF v_current_count >= v_budget THEN
    RETURN QUERY SELECT false, 'daily_budget_exhausted'::TEXT, v_current_count, v_budget;
    RETURN;
  END IF;

  -- Reserve the slot by stamping a placeholder dispatched_at and provider='reserved'.
  -- The actual sender call will overwrite to 'resend' on success or 'failed' on error.
  -- This count is now visible to the next concurrent call, which will see N+1.
  UPDATE warm_outbound_staging
  SET dispatched_at = NOW(),
      send_provider = 'resend'  -- counts toward budget immediately
  WHERE id = p_staging_id;

  RETURN QUERY SELECT true, 'reserved'::TEXT, v_current_count + 1, v_budget;
END;
$$;