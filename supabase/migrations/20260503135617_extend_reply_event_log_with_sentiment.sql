CREATE OR REPLACE FUNCTION public.log_inbound_reply_events()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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

    IF NEW.staging_id IS NOT NULL THEN
      UPDATE warm_outbound_staging
      SET replied_at = COALESCE(replied_at, NEW.received_at)
      WHERE id = NEW.staging_id AND replied_at IS NULL;
    END IF;

    RETURN NEW;
  END IF;

  -- Classification arrived: emit reply_sentiment as a first-class dimension
  IF NEW.classification IS NOT NULL AND OLD.classification IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.staging_id, NEW.attio_record_id, NEW.from_email,
      'reply_classified', 'claude_haiku',
      jsonb_build_object(
        'reply_id', NEW.id,
        'classification', NEW.classification,
        'reply_sentiment', NEW.reply_sentiment,
        'asset_requested', NEW.asset_requested,
        'classification_confidence', NEW.classification_confidence,
        'recommended_stage', NEW.recommended_stage,
        'has_draft', NEW.draft_body IS NOT NULL
      )
    );
  END IF;

  -- Asset request specifically: emit a high-priority event for follow-up
  IF NEW.asset_requested = TRUE AND (OLD.asset_requested IS NULL OR OLD.asset_requested = FALSE) THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.staging_id, NEW.attio_record_id, NEW.from_email,
      'asset_requested', 'cw',
      jsonb_build_object(
        'reply_id', NEW.id,
        'gmail_thread_id', NEW.gmail_thread_id,
        'reply_sentiment', NEW.reply_sentiment
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;