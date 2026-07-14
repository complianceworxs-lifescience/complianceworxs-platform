-- Enforce: send_message_id can only be set when dispatched_at is also set.
-- Prevents future dirty data (stale message_id without actual send completion)
-- from re-introducing the bug we caught in system testing.

ALTER TABLE public.warm_outbound_staging
  ADD CONSTRAINT send_message_id_requires_dispatched_at
  CHECK (
    send_message_id IS NULL
    OR dispatched_at IS NOT NULL
  );

COMMENT ON CONSTRAINT send_message_id_requires_dispatched_at ON public.warm_outbound_staging IS
  'Prevents stale send_message_id without confirmed dispatch. If send_message_id is set, dispatched_at must also be set. Closes the followup-drafter dirty-data bug caught in system test 2026-05-10.';