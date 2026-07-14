-- Enhance the existing trigger so every outbound event carries the enrichment source
-- (prospeo, hunter, manual, etc.) and the buyer pipeline state. This lets PostHog
-- segment funnels by enrichment provider.

CREATE OR REPLACE FUNCTION log_staging_state_change()
RETURNS TRIGGER AS $$
DECLARE
  v_enrichment_source TEXT;
BEGIN
  v_enrichment_source := COALESCE(NEW.domain_resolution_method, NEW.source, 'unknown');

  IF TG_OP = 'INSERT' THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'lead_added_to_staging',
      COALESCE(NEW.source, 'unknown'),
      jsonb_build_object(
        'full_name', NEW.full_name, 'linkedin_url', NEW.linkedin_url,
        'company', NEW.company, 'enrichment_status', NEW.enrichment_status,
        'enrichment_source', v_enrichment_source
      )
    );
    RETURN NEW;
  END IF;

  IF NEW.email IS NOT NULL AND OLD.email IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'lead_email_found',
      v_enrichment_source,
      jsonb_build_object(
        'full_name', NEW.full_name, 'company', NEW.company, 'company_domain', NEW.company_domain,
        'job_title', NEW.job_title, 'linkedin_url', NEW.linkedin_url,
        'enrichment_source', v_enrichment_source
      )
    );
  END IF;

  IF NEW.enrichment_status IS DISTINCT FROM OLD.enrichment_status
     AND NEW.enrichment_status LIKE 'failed_%' THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'lead_enrichment_failed',
      v_enrichment_source,
      jsonb_build_object(
        'full_name', NEW.full_name, 'failure_reason', NEW.enrichment_status,
        'linkedin_url', NEW.linkedin_url, 'enrichment_source', v_enrichment_source
      )
    );
  END IF;

  IF NEW.enrichment_status = 'disqualified_not_fda_regulated'
     AND OLD.enrichment_status IS DISTINCT FROM NEW.enrichment_status THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'lead_disqualified', 'fit_filter',
      jsonb_build_object(
        'full_name', NEW.full_name, 'reason', 'not_fda_regulated',
        'company_domain', NEW.company_domain, 'job_title', NEW.job_title,
        'enrichment_source', v_enrichment_source
      )
    );
  END IF;

  IF NEW.buyer_pipeline_entry_id IS NOT NULL AND OLD.buyer_pipeline_entry_id IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'lead_promoted_to_pipeline', 'attio',
      jsonb_build_object(
        'full_name', NEW.full_name, 'company', NEW.company, 'job_title', NEW.job_title,
        'pipeline_stage', COALESCE(NEW.buyer_pipeline_stage, 'Engaged'),
        'pipeline_entry_id', NEW.buyer_pipeline_entry_id,
        'enrichment_source', v_enrichment_source
      )
    );
  END IF;

  IF NEW.buyer_pipeline_stage IS DISTINCT FROM OLD.buyer_pipeline_stage
     AND NEW.buyer_pipeline_stage IS NOT NULL
     AND OLD.buyer_pipeline_stage IS NOT NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'pipeline_stage_changed', 'attio',
      jsonb_build_object(
        'full_name', NEW.full_name, 'company', NEW.company,
        'from_stage', OLD.buyer_pipeline_stage, 'to_stage', NEW.buyer_pipeline_stage,
        'enrichment_source', v_enrichment_source
      )
    );
  END IF;

  IF NEW.dispatched_at IS NOT NULL AND OLD.dispatched_at IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'outbound_email_sent', 'attio',
      jsonb_build_object('full_name', NEW.full_name, 'company', NEW.company, 
                         'job_title', NEW.job_title, 'enrichment_source', v_enrichment_source)
    );
  END IF;

  IF NEW.replied_at IS NOT NULL AND OLD.replied_at IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'outbound_reply_received', 'attio',
      jsonb_build_object(
        'full_name', NEW.full_name, 'company', NEW.company,
        'enrichment_source', v_enrichment_source,
        'days_to_reply', CASE WHEN NEW.dispatched_at IS NOT NULL
                              THEN EXTRACT(EPOCH FROM (NEW.replied_at - NEW.dispatched_at)) / 86400
                              ELSE NULL END
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;