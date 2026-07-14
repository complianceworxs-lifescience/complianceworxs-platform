-- Real-time PostHog streaming: every outbound_events INSERT immediately POSTs to PostHog /capture.
-- Replaces the outbound-events-posthog-sync-1min cron job.
-- Idempotency: PostHog dedupes on $event_uuid which we set to outbound_events.id.

CREATE OR REPLACE FUNCTION public.stream_outbound_event_to_posthog()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_posthog_key TEXT := 'phc_pYjwPXihpZPL8MaS86gxmEZMXvi3ZsvKdWuqZzLQEjt7';
  v_payload JSONB;
  v_distinct_id TEXT;
  v_request_id BIGINT;
BEGIN
  -- Use email as distinct_id when available, else staging_id, else event id
  v_distinct_id := COALESCE(NEW.email, 'staging_' || NEW.staging_id::text, 'event_' || NEW.id::text);

  v_payload := jsonb_build_object(
    'api_key', v_posthog_key,
    'event', NEW.event_name,
    'distinct_id', v_distinct_id,
    'timestamp', NEW.created_at,
    'properties', COALESCE(NEW.properties, '{}'::jsonb) || jsonb_build_object(
      '$event_uuid', NEW.id::text,
      'staging_id', NEW.staging_id,
      'attio_record_id', NEW.attio_record_id,
      'provider', NEW.provider,
      'email', NEW.email,
      'source', 'cw_outbound_pipeline'
    )
  );

  BEGIN
    SELECT net.http_post(
      url := 'https://us.i.posthog.com/capture/',
      body := v_payload,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 5000
    ) INTO v_request_id;

    -- Mark synced so the legacy posthog-sync cron skips it (defensive double-up guard)
    -- Use a separate UPDATE to avoid recursion since this trigger is on outbound_events
    UPDATE outbound_events
       SET posthog_synced_at = NOW(), posthog_request_id = v_request_id
     WHERE id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    -- Don't block the insert; only log
    RAISE NOTICE 'PostHog stream failed for event %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- Add tracking columns if missing
ALTER TABLE outbound_events
  ADD COLUMN IF NOT EXISTS posthog_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS posthog_request_id BIGINT;

DROP TRIGGER IF EXISTS outbound_events_posthog_stream ON outbound_events;
CREATE TRIGGER outbound_events_posthog_stream
  AFTER INSERT ON outbound_events
  FOR EACH ROW
  EXECUTE FUNCTION stream_outbound_event_to_posthog();