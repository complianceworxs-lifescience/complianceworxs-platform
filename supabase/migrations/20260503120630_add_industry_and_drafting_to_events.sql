-- Industry attribution + draft tracking for PostHog funnel
CREATE OR REPLACE FUNCTION log_staging_state_change()
RETURNS TRIGGER AS $$
DECLARE
  v_enrichment_source TEXT;
  v_industry_props JSONB;
BEGIN
  v_enrichment_source := COALESCE(NEW.domain_resolution_method, NEW.source, 'unknown');
  v_industry_props := jsonb_build_object(
    'enrichment_source', v_enrichment_source,
    'industry', NEW.industry,
    'role_seniority', NEW.role_seniority,
    'role_function', NEW.role_function,
    'fit_score', NEW.fit_score
  );

  IF TG_OP = 'INSERT' THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'lead_added_to_staging',
      COALESCE(NEW.source, 'unknown'),
      v_industry_props || jsonb_build_object(
        'full_name', NEW.full_name, 'linkedin_url', NEW.linkedin_url,
        'company', NEW.company, 'enrichment_status', NEW.enrichment_status
      )
    );
    RETURN NEW;
  END IF;

  IF NEW.email IS NOT NULL AND OLD.email IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'lead_email_found', v_enrichment_source,
      v_industry_props || jsonb_build_object(
        'full_name', NEW.full_name, 'company', NEW.company, 'company_domain', NEW.company_domain,
        'job_title', NEW.job_title, 'linkedin_url', NEW.linkedin_url
      )
    );
  END IF;

  IF NEW.enrichment_status IS DISTINCT FROM OLD.enrichment_status
     AND NEW.enrichment_status LIKE 'failed_%' THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'lead_enrichment_failed', v_enrichment_source,
      v_industry_props || jsonb_build_object(
        'full_name', NEW.full_name, 'failure_reason', NEW.enrichment_status, 'linkedin_url', NEW.linkedin_url
      )
    );
  END IF;

  IF NEW.enrichment_status IN ('disqualified_not_fda_regulated', 'disqualified_non_target')
     AND OLD.enrichment_status IS DISTINCT FROM NEW.enrichment_status THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'lead_disqualified', 
      CASE WHEN NEW.enrichment_status = 'disqualified_non_target' THEN 'fit_scorer' ELSE 'fit_filter' END,
      v_industry_props || jsonb_build_object(
        'full_name', NEW.full_name, 'reason', NEW.enrichment_status,
        'company_domain', NEW.company_domain, 'job_title', NEW.job_title
      )
    );
  END IF;

  -- NEW: fit-scoring event
  IF NEW.fit_score IS NOT NULL AND OLD.fit_score IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'lead_fit_scored', 'claude_haiku',
      v_industry_props || jsonb_build_object(
        'full_name', NEW.full_name, 'company', NEW.company,
        'breakdown', NEW.fit_score_breakdown
      )
    );
  END IF;

  -- NEW: first-touch drafted event
  IF NEW.first_touch_drafted_at IS NOT NULL AND OLD.first_touch_drafted_at IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'lead_first_touch_drafted', 'claude_haiku',
      v_industry_props || jsonb_build_object(
        'full_name', NEW.full_name, 'company', NEW.company,
        'subject', NEW.first_touch_draft_subject
      )
    );
  END IF;

  IF NEW.buyer_pipeline_entry_id IS NOT NULL AND OLD.buyer_pipeline_entry_id IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'lead_promoted_to_pipeline', 'attio',
      v_industry_props || jsonb_build_object(
        'full_name', NEW.full_name, 'company', NEW.company, 'job_title', NEW.job_title,
        'pipeline_stage', COALESCE(NEW.buyer_pipeline_stage, 'Engaged'),
        'pipeline_entry_id', NEW.buyer_pipeline_entry_id
      )
    );
  END IF;

  IF NEW.buyer_pipeline_stage IS DISTINCT FROM OLD.buyer_pipeline_stage
     AND NEW.buyer_pipeline_stage IS NOT NULL
     AND OLD.buyer_pipeline_stage IS NOT NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'pipeline_stage_changed', 'attio',
      v_industry_props || jsonb_build_object(
        'full_name', NEW.full_name, 'company', NEW.company,
        'from_stage', OLD.buyer_pipeline_stage, 'to_stage', NEW.buyer_pipeline_stage
      )
    );
  END IF;

  IF NEW.dispatched_at IS NOT NULL AND OLD.dispatched_at IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'outbound_email_sent', 'attio',
      v_industry_props || jsonb_build_object(
        'full_name', NEW.full_name, 'company', NEW.company, 'job_title', NEW.job_title
      )
    );
  END IF;

  IF NEW.replied_at IS NOT NULL AND OLD.replied_at IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'outbound_reply_received', 'attio',
      v_industry_props || jsonb_build_object(
        'full_name', NEW.full_name, 'company', NEW.company,
        'days_to_reply', CASE WHEN NEW.dispatched_at IS NOT NULL
                              THEN EXTRACT(EPOCH FROM (NEW.replied_at - NEW.dispatched_at)) / 86400
                              ELSE NULL END
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;