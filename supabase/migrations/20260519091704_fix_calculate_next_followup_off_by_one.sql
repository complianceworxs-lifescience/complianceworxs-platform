-- Fix: after sending touch N, stage must be followup_{N+1}_due not followup_N_due.
-- Old logic: seq_count=1 → stage=followup_1_due (overrode dispatcher which correctly set followup_2_due).
-- New logic: seq_count=1 → stage=followup_2_due (touch 2 is what's due next).
CREATE OR REPLACE FUNCTION public.calculate_next_followup()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.last_sequence_email_at IS DISTINCT FROM OLD.last_sequence_email_at
     AND NEW.last_sequence_email_at IS NOT NULL
     AND NEW.replied_at IS NULL
     AND NEW.archived_at IS NULL
  THEN
    -- After touch N is sent (sequence_email_count = N), touch N+1 is what's due.
    -- Touch 1 sent → followup_2_due in 3 days
    -- Touch 2 sent → followup_3_due (breakup) in 4 days
    -- Touch 3 sent → sequence complete
    IF NEW.sequence_email_count = 1 THEN
      NEW.next_followup_due_at = NEW.last_sequence_email_at + INTERVAL '3 days';
      NEW.followup_stage = 'followup_2_due';
    ELSIF NEW.sequence_email_count = 2 THEN
      NEW.next_followup_due_at = NEW.last_sequence_email_at + INTERVAL '4 days';
      NEW.followup_stage = 'followup_3_due';
    ELSIF NEW.sequence_email_count = 3 THEN
      NEW.next_followup_due_at = NEW.last_sequence_email_at + INTERVAL '7 days';
      NEW.followup_stage = 'breakup_due';
    ELSE
      NEW.next_followup_due_at = NULL;
      NEW.followup_stage = 'sequence_complete';
    END IF;
  END IF;

  IF NEW.replied_at IS NOT NULL AND OLD.replied_at IS NULL THEN
    NEW.next_followup_due_at = NULL;
    NEW.followup_stage = 'replied';
  END IF;

  RETURN NEW;
END;
$function$;