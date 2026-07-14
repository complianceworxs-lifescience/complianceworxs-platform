-- When replied_at or dm_replied_at is set, automatically pause automation
CREATE OR REPLACE FUNCTION auto_pause_on_reply()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.replied_at IS NOT NULL AND (OLD.replied_at IS NULL OR OLD.replied_at IS DISTINCT FROM NEW.replied_at))
     OR (NEW.dm_replied_at IS NOT NULL AND (OLD.dm_replied_at IS NULL OR OLD.dm_replied_at IS DISTINCT FROM NEW.dm_replied_at))
  THEN
    NEW.automation_paused := true;
    IF NEW.automation_paused_reason IS NULL THEN
      NEW.automation_paused_reason := 'replied_awaiting_human_response';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_pause_on_reply ON warm_outbound_staging;

CREATE TRIGGER trg_auto_pause_on_reply
  BEFORE UPDATE ON warm_outbound_staging
  FOR EACH ROW
  EXECUTE FUNCTION auto_pause_on_reply();