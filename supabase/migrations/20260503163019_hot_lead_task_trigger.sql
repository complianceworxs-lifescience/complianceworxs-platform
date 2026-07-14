-- Trigger fires hot-lead-task-creator on inbound_replies the moment 
-- reply_sentiment is set to 'asset_requested' or 'positive_intent'.
-- This is the SLA-critical cascade: classifier classifies -> task created within seconds.

CREATE OR REPLACE FUNCTION public.fire_hot_lead_task_creator()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_base_url TEXT := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1';
  v_secret TEXT := '3i_6DdFRT-EmxT0nczskfeA3HshAnu64w40C9-WmkAE';
  v_request_id BIGINT;
BEGIN
  -- Only fire when reply_sentiment changes to a hot value AND no task exists yet
  IF NEW.reply_sentiment IN ('asset_requested', 'positive_intent')
     AND (OLD.reply_sentiment IS NULL OR OLD.reply_sentiment IS DISTINCT FROM NEW.reply_sentiment)
     AND NEW.hot_lead_task_id IS NULL
     AND NEW.attio_record_id IS NOT NULL THEN
    BEGIN
      SELECT net.http_get(
        url := v_base_url || '/hot-lead-task-creator?reply_id=' || NEW.id || '&secret=' || v_secret,
        timeout_milliseconds := 30000
      ) INTO v_request_id;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO outbound_events (staging_id, event_name, provider, properties)
      VALUES (NEW.staging_id, 'hot_lead_task_dispatch_failed', 'trigger',
        jsonb_build_object('reply_id', NEW.id, 'error', SQLERRM));
    END;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_inbound_replies_hot_lead ON inbound_replies;

CREATE TRIGGER trg_inbound_replies_hot_lead
AFTER UPDATE ON inbound_replies
FOR EACH ROW
EXECUTE FUNCTION fire_hot_lead_task_creator();