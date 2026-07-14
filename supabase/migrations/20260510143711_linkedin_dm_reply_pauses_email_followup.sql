-- When a LinkedIn DM reply is recorded (dm_replied_at gets set),
-- automatically set replied_at so the email follow-up sequence stops firing.
-- This closes the gap where someone replies on LinkedIn but keeps getting emails.

CREATE OR REPLACE FUNCTION public.sync_dm_reply_to_email_replied()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when dm_replied_at transitions from NULL to a value
  IF NEW.dm_replied_at IS NOT NULL
     AND (OLD.dm_replied_at IS NULL OR OLD.dm_replied_at IS DISTINCT FROM NEW.dm_replied_at)
     AND NEW.replied_at IS NULL
  THEN
    NEW.replied_at = NEW.dm_replied_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_dm_reply ON public.warm_outbound_staging;

CREATE TRIGGER trg_sync_dm_reply
  BEFORE UPDATE OF dm_replied_at
  ON public.warm_outbound_staging
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_dm_reply_to_email_replied();

COMMENT ON FUNCTION public.sync_dm_reply_to_email_replied IS
  'Cross-channel reply sync: when LinkedIn DM reply lands (dm_replied_at), set replied_at so email follow-up sequence stops. Prevents redundant outreach when a contact has already engaged on another channel.';