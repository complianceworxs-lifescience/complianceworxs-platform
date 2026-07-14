-- Outbound transaction log: every state change that should be visible in PostHog
CREATE TABLE outbound_events (
  id BIGSERIAL PRIMARY KEY,
  staging_id BIGINT REFERENCES warm_outbound_staging(id) ON DELETE SET NULL,
  attio_record_id TEXT,
  email TEXT,
  event_name TEXT NOT NULL,
  provider TEXT,
  properties JSONB DEFAULT '{}'::jsonb,
  posthog_synced_at TIMESTAMPTZ,
  posthog_sync_attempts INTEGER DEFAULT 0,
  posthog_last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_outbound_events_unsynced ON outbound_events (created_at) WHERE posthog_synced_at IS NULL;
CREATE INDEX idx_outbound_events_staging ON outbound_events (staging_id);
CREATE INDEX idx_outbound_events_attio ON outbound_events (attio_record_id);
CREATE INDEX idx_outbound_events_name ON outbound_events (event_name, created_at DESC);

-- Trigger: any UPDATE to warm_outbound_staging that changes enrichment_status writes an event
CREATE OR REPLACE FUNCTION log_staging_state_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log meaningful state changes
  IF TG_OP = 'INSERT' THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email,
      'lead_added_to_staging',
      COALESCE(NEW.source, 'unknown'),
      jsonb_build_object(
        'full_name', NEW.full_name,
        'linkedin_url', NEW.linkedin_url,
        'company', NEW.company,
        'enrichment_status', NEW.enrichment_status
      )
    );
    RETURN NEW;
  END IF;

  -- Enrichment success: email arrives where there was none
  IF NEW.email IS NOT NULL AND OLD.email IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email,
      'lead_email_found',
      COALESCE(NEW.domain_resolution_method, 'unknown'),
      jsonb_build_object(
        'full_name', NEW.full_name,
        'company', NEW.company,
        'company_domain', NEW.company_domain,
        'job_title', NEW.job_title,
        'linkedin_url', NEW.linkedin_url
      )
    );
  END IF;

  -- Enrichment failure: status changed and now contains 'failed'
  IF NEW.enrichment_status IS DISTINCT FROM OLD.enrichment_status
     AND NEW.enrichment_status LIKE 'failed_%' THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email,
      'lead_enrichment_failed',
      COALESCE(NEW.domain_resolution_method, 'unknown'),
      jsonb_build_object(
        'full_name', NEW.full_name,
        'failure_reason', NEW.enrichment_status,
        'linkedin_url', NEW.linkedin_url
      )
    );
  END IF;

  -- Disqualification
  IF NEW.enrichment_status = 'disqualified_not_fda_regulated'
     AND OLD.enrichment_status IS DISTINCT FROM NEW.enrichment_status THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email,
      'lead_disqualified',
      'fit_filter',
      jsonb_build_object(
        'full_name', NEW.full_name,
        'reason', 'not_fda_regulated',
        'company_domain', NEW.company_domain,
        'job_title', NEW.job_title
      )
    );
  END IF;

  -- First dispatch
  IF NEW.dispatched_at IS NOT NULL AND OLD.dispatched_at IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email,
      'outbound_email_sent',
      'attio',
      jsonb_build_object(
        'full_name', NEW.full_name,
        'company', NEW.company,
        'job_title', NEW.job_title
      )
    );
  END IF;

  -- Reply received
  IF NEW.replied_at IS NOT NULL AND OLD.replied_at IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email,
      'outbound_reply_received',
      'attio',
      jsonb_build_object(
        'full_name', NEW.full_name,
        'company', NEW.company,
        'days_to_reply',
          CASE WHEN NEW.dispatched_at IS NOT NULL
               THEN EXTRACT(EPOCH FROM (NEW.replied_at - NEW.dispatched_at)) / 86400
               ELSE NULL END
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER warm_outbound_staging_event_log
AFTER INSERT OR UPDATE ON warm_outbound_staging
FOR EACH ROW
EXECUTE FUNCTION log_staging_state_change();

-- Enable realtime on the events table for downstream consumers
ALTER PUBLICATION supabase_realtime ADD TABLE outbound_events;