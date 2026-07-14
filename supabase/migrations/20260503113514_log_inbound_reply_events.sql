-- Trigger on inbound_replies: every new reply logs to outbound_events,
-- and every classification logs a follow-up event.
-- Both flow through to PostHog via the existing 60s sync cron.

CREATE OR REPLACE FUNCTION log_inbound_reply_events()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.staging_id, NEW.attio_record_id, NEW.from_email,
      'inbound_reply_received', 'gmail',
      jsonb_build_object(
        'reply_id', NEW.id,
        'gmail_thread_id', NEW.gmail_thread_id,
        'subject', NEW.subject,
        'from_name', NEW.from_name
      )
    );

    -- Also bump replied_at on staging so the existing trigger logs outbound_reply_received
    IF NEW.staging_id IS NOT NULL THEN
      UPDATE warm_outbound_staging
      SET replied_at = COALESCE(replied_at, NEW.received_at)
      WHERE id = NEW.staging_id AND replied_at IS NULL;
    END IF;

    RETURN NEW;
  END IF;

  -- Classification arrived
  IF NEW.classification IS NOT NULL AND OLD.classification IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.staging_id, NEW.attio_record_id, NEW.from_email,
      'reply_classified', 'claude_haiku',
      jsonb_build_object(
        'reply_id', NEW.id,
        'classification', NEW.classification,
        'classification_confidence', NEW.classification_confidence,
        'recommended_stage', NEW.recommended_stage,
        'has_draft', NEW.draft_body IS NOT NULL
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inbound_replies_event_log ON inbound_replies;
CREATE TRIGGER inbound_replies_event_log
AFTER INSERT OR UPDATE ON inbound_replies
FOR EACH ROW
EXECUTE FUNCTION log_inbound_reply_events();