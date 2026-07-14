-- Add followup tracking columns
ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS next_followup_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS followup_stage TEXT,
  ADD COLUMN IF NOT EXISTS followup_flagged_at TIMESTAMPTZ;

-- Index for fast daily brief lookups
CREATE INDEX IF NOT EXISTS idx_warm_outbound_followup_due
  ON warm_outbound_staging (next_followup_due_at)
  WHERE archived_at IS NULL AND replied_at IS NULL AND automation_paused = false;

-- Trigger function: when an email is sent, calculate the next follow-up
CREATE OR REPLACE FUNCTION calculate_next_followup()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when last_sequence_email_at changes (i.e., a new email was sent)
  IF NEW.last_sequence_email_at IS DISTINCT FROM OLD.last_sequence_email_at
     AND NEW.last_sequence_email_at IS NOT NULL
     AND NEW.replied_at IS NULL
     AND NEW.archived_at IS NULL
  THEN
    -- Cadence based on which email # was just sent
    -- Email 1 sent → flag for follow-up #1 in 3 days
    -- Email 2 sent → flag for follow-up #2 in 4 days  
    -- Email 3 sent → flag for breakup email in 7 days
    -- Email 4 sent → archive (no more follow-ups)
    
    IF NEW.sequence_email_count = 1 THEN
      NEW.next_followup_due_at = NEW.last_sequence_email_at + INTERVAL '3 days';
      NEW.followup_stage = 'followup_1_due';
    ELSIF NEW.sequence_email_count = 2 THEN
      NEW.next_followup_due_at = NEW.last_sequence_email_at + INTERVAL '4 days';
      NEW.followup_stage = 'followup_2_due';
    ELSIF NEW.sequence_email_count = 3 THEN
      NEW.next_followup_due_at = NEW.last_sequence_email_at + INTERVAL '7 days';
      NEW.followup_stage = 'breakup_due';
    ELSE
      NEW.next_followup_due_at = NULL;
      NEW.followup_stage = 'sequence_complete';
    END IF;
  END IF;
  
  -- If reply detected, clear all follow-up state
  IF NEW.replied_at IS NOT NULL AND OLD.replied_at IS NULL THEN
    NEW.next_followup_due_at = NULL;
    NEW.followup_stage = 'replied';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calculate_next_followup ON warm_outbound_staging;
CREATE TRIGGER trg_calculate_next_followup
  BEFORE UPDATE ON warm_outbound_staging
  FOR EACH ROW
  EXECUTE FUNCTION calculate_next_followup();