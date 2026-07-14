DROP VIEW IF EXISTS pipeline_view CASCADE;

CREATE OR REPLACE VIEW pipeline_view AS
SELECT
  s.id AS staging_id,
  s.email,
  s.first_name,
  s.last_name,
  s.full_name,
  s.company,
  s.company_domain,
  s.job_title,
  s.linkedin_url,
  s.cohort_label,
  s.case_file_interest,
  s.attio_record_id,
  s.created_at AS entered_pipeline_at,
  s.created_at AS entered_enrichment_at,
  s.enriched_at,
  s.enrichment_status,
  s.dispatched_at,
  s.replied_at,
  s.last_attio_status,
  s.automation_paused,
  s.automation_paused_reason,
  s.sequence_email_count,
  s.last_sequence_email_at,
  s.nurture_started_at,
  s.archived_at,
  s.archive_reason,

  -- Stuck telemetry (asked for: 24hr alert)
  CASE
    WHEN s.archived_at IS NOT NULL THEN NULL
    WHEN s.dispatched_at IS NOT NULL THEN NULL
    WHEN s.enriched_at IS NULL THEN EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 3600
    ELSE NULL
  END AS hours_stuck_in_enrichment,

  -- Stage logic: ordered by precedence, first match wins
  CASE
    -- Terminal: archived (renamed from incomplete_data)
    WHEN s.archived_at IS NOT NULL THEN 'archived'
    
    -- No-go: missing both contact paths after enrichment
    WHEN s.enriched_at IS NOT NULL
         AND (s.email IS NULL OR s.email = '')
         AND (s.linkedin_url IS NULL OR s.linkedin_url = '')
      THEN 'archived'

    -- Active conversation states (highest priority above sequencing)
    WHEN s.last_attio_status = 'Qualified' THEN 'qualified'
    WHEN s.last_attio_status = 'Disqualified' THEN 'disqualified'
    WHEN s.replied_at IS NOT NULL OR s.last_attio_status = 'Replied' THEN 'engaged'

    -- Long-term nurture: 4+ emails sent, 14+ days since last touch, no reply
    WHEN s.sequence_email_count >= 4
         AND s.last_sequence_email_at < NOW() - INTERVAL '14 days'
         AND s.replied_at IS NULL
      THEN 'nurture_long_term'

    -- Active outreach
    WHEN s.dispatched_at IS NOT NULL THEN 'emailed'

    -- Pre-outreach states
    WHEN s.email IS NOT NULL AND s.email <> '' AND s.attio_record_id IS NOT NULL THEN 'ready_to_email'
    WHEN s.enriched_at IS NOT NULL AND (s.email IS NULL OR s.email = '') 
         AND s.linkedin_url IS NOT NULL AND s.linkedin_url <> '' THEN 'no_email_found'
    WHEN s.enriched_at IS NULL THEN 'awaiting_enrichment'
    ELSE 'unknown'
  END AS stage

FROM warm_outbound_staging s;

-- Pipeline summary aggregates
DROP VIEW IF EXISTS pipeline_summary CASCADE;
CREATE OR REPLACE VIEW pipeline_summary AS
SELECT
  stage,
  COUNT(*) AS lead_count,
  COUNT(*) FILTER (WHERE entered_pipeline_at > NOW() - INTERVAL '7 days') AS new_last_7d,
  COUNT(*) FILTER (WHERE entered_pipeline_at > NOW() - INTERVAL '24 hours') AS new_last_24h
FROM pipeline_view
GROUP BY stage
ORDER BY 
  CASE stage
    WHEN 'qualified' THEN 1
    WHEN 'engaged' THEN 2
    WHEN 'emailed' THEN 3
    WHEN 'ready_to_email' THEN 4
    WHEN 'no_email_found' THEN 5
    WHEN 'awaiting_enrichment' THEN 6
    WHEN 'nurture_long_term' THEN 7
    WHEN 'disqualified' THEN 8
    WHEN 'archived' THEN 9
    ELSE 99
  END;