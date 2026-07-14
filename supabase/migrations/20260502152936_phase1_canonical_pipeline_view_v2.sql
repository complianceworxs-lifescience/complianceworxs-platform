-- THE single source of truth: pipeline_view
CREATE OR REPLACE VIEW pipeline_view AS
SELECT
  s.id AS staging_id,
  s.attio_record_id,
  s.full_name,
  s.first_name,
  s.last_name,
  s.email,
  s.job_title,
  s.company,
  s.company_domain,
  s.linkedin_url,
  s.case_file_interest,
  s.enrichment_status,
  s.created_at,
  s.enriched_at,
  s.pushed_at,
  s.dispatched_at,
  CASE
    WHEN s.dispatched_at IS NOT NULL                                      THEN 'emailed'
    WHEN s.email IS NOT NULL AND s.attio_record_id IS NOT NULL            THEN 'ready_to_email'
    WHEN s.enrichment_status = 'pending' AND s.linkedin_url IS NOT NULL   THEN 'awaiting_enrichment'
    WHEN s.enrichment_status = 'failed_no_match'                          THEN 'no_email_found'
    WHEN s.enrichment_status LIKE 'failed_%'                              THEN 'enrichment_failed'
    WHEN s.email IS NULL AND s.linkedin_url IS NULL                       THEN 'incomplete_data'
    ELSE 'other'
  END AS pipeline_stage
FROM warm_outbound_staging s;

COMMENT ON VIEW pipeline_view IS 'CANONICAL: who is in pipeline. Single source of truth.';

CREATE OR REPLACE VIEW pipeline_summary AS
SELECT
  pipeline_stage,
  COUNT(*) AS count,
  MAX(created_at) AS most_recent
FROM pipeline_view
GROUP BY pipeline_stage
ORDER BY count DESC;