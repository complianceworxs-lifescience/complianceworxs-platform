-- Hunter verification quota exhausted. Reverting verifier from the cascade so
-- drafter completes -> sender fires directly (the v9 behavior). Verifier stays
-- deployed for future use if we add a verification budget.
CREATE OR REPLACE FUNCTION public.log_staging_state_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_enrichment_source TEXT;
  v_industry_props JSONB;
  v_base_url TEXT := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1';
  v_secret TEXT := '3i_6DdFRT-EmxT0nczskfeA3HshAnu64w40C9-WmkAE';
  v_request_id BIGINT;
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

    IF NEW.linkedin_url IS NOT NULL
       AND NEW.email IS NULL
       AND COALESCE(NEW.enrichment_status, 'pending') = 'pending'
       AND COALESCE(NEW.automation_paused, false) = false
       AND COALESCE(NEW.is_paying_customer, false) = false THEN
      BEGIN
        SELECT net.http_get(
          url := v_base_url || '/hunter-linkedin-enrich?id=' || NEW.id || '&secret=' || v_secret,
          timeout_milliseconds := 60000
        ) INTO v_request_id;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO outbound_events (staging_id, event_name, provider, properties)
        VALUES (NEW.id, 'cascade_dispatch_failed', 'trigger',
          jsonb_build_object('stage', 'hunter_enrich', 'error', SQLERRM));
      END;
    END IF;

    IF NEW.linkedin_url IS NOT NULL
       AND NEW.full_name IS NOT NULL
       AND NEW.attio_record_id IS NULL
       AND COALESCE(NEW.enrichment_status, 'pending') NOT LIKE 'disqualified%'
       AND COALESCE(NEW.automation_paused, false) = false
       AND COALESCE(NEW.is_paying_customer, false) = false THEN
      BEGIN
        SELECT net.http_get(
          url := v_base_url || '/warm-outbound-attio-pusher?id=' || NEW.id,
          timeout_milliseconds := 60000
        ) INTO v_request_id;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO outbound_events (staging_id, event_name, provider, properties)
        VALUES (NEW.id, 'cascade_dispatch_failed', 'trigger',
          jsonb_build_object('stage', 'attio_push', 'error', SQLERRM));
      END;
    END IF;

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
    IF COALESCE(NEW.automation_paused, false) = false
       AND COALESCE(NEW.is_paying_customer, false) = false
       AND NEW.enrichment_status = 'enriched'
       AND NEW.fit_score IS NULL THEN
      BEGIN
        SELECT net.http_get(
          url := v_base_url || '/lead-fit-scorer?id=' || NEW.id,
          timeout_milliseconds := 60000
        ) INTO v_request_id;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO outbound_events (staging_id, event_name, provider, properties)
        VALUES (NEW.id, 'cascade_dispatch_failed', 'trigger',
          jsonb_build_object('stage', 'fit_scorer', 'error', SQLERRM));
      END;
    END IF;
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

  IF NEW.enrichment_status IN ('disqualified_not_fda_regulated', 'disqualified_non_target', 'disqualified_junk_company')
     AND OLD.enrichment_status IS DISTINCT FROM NEW.enrichment_status THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'lead_disqualified',
      CASE 
        WHEN NEW.enrichment_status = 'disqualified_non_target' THEN 'fit_scorer'
        WHEN NEW.enrichment_status = 'disqualified_junk_company' THEN 'ingest_filter'
        ELSE 'fit_filter' 
      END,
      v_industry_props || jsonb_build_object(
        'full_name', NEW.full_name, 'reason', NEW.enrichment_status,
        'company_domain', NEW.company_domain, 'job_title', NEW.job_title
      )
    );
  END IF;

  IF NEW.fit_score IS NOT NULL AND OLD.fit_score IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'lead_fit_scored', 'claude_haiku',
      v_industry_props || jsonb_build_object(
        'full_name', NEW.full_name, 'company', NEW.company,
        'breakdown', NEW.fit_score_breakdown
      )
    );
    IF NEW.fit_score >= 70
       AND COALESCE(NEW.automation_paused, false) = false
       AND COALESCE(NEW.is_paying_customer, false) = false
       AND NEW.attio_record_id IS NOT NULL
       AND NEW.first_touch_draft_body IS NULL THEN
      BEGIN
        SELECT net.http_get(
          url := v_base_url || '/first-touch-drafter?id=' || NEW.id,
          timeout_milliseconds := 60000
        ) INTO v_request_id;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO outbound_events (staging_id, event_name, provider, properties)
        VALUES (NEW.id, 'cascade_dispatch_failed', 'trigger',
          jsonb_build_object('stage', 'first_touch_drafter', 'error', SQLERRM));
      END;
    END IF;
  END IF;

  IF NEW.first_touch_drafted_at IS NOT NULL AND OLD.first_touch_drafted_at IS NULL THEN
    INSERT INTO outbound_events (staging_id, attio_record_id, email, event_name, provider, properties)
    VALUES (
      NEW.id, NEW.attio_record_id, NEW.email, 'lead_first_touch_drafted', 'claude_haiku',
      v_industry_props || jsonb_build_object(
        'full_name', NEW.full_name, 'company', NEW.company,
        'subject', NEW.first_touch_draft_subject
      )
    );
    -- VERIFIER STEP REMOVED. Drafter still doesn't auto-approve in v11
    -- (it pauses on validation failure). We need drafter to auto-approve again.
    -- See drafter v12 deploy below.
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

  IF NEW.email_approved = true AND COALESCE(OLD.email_approved, false) = false THEN
    IF COALESCE(NEW.automation_paused, false) = false
       AND COALESCE(NEW.is_paying_customer, false) = false
       AND NEW.dispatched_at IS NULL
       AND NEW.first_touch_draft_body IS NOT NULL THEN
      BEGIN
        SELECT net.http_get(
          url := v_base_url || '/outbound-sender?id=' || NEW.id,
          timeout_milliseconds := 60000
        ) INTO v_request_id;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO outbound_events (staging_id, event_name, provider, properties)
        VALUES (NEW.id, 'cascade_dispatch_failed', 'trigger',
          jsonb_build_object('stage', 'outbound_sender', 'error', SQLERRM));
      END;
    END IF;
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
$function$;