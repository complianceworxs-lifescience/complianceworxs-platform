
CREATE OR REPLACE VIEW v_queue_enrichment AS
SELECT id, full_name, linkedin_url, email, company, job_title, source, created_at
FROM warm_outbound_staging
WHERE enrichment_status IN ('pending_enrichment', 'new')
  AND archived_at IS NULL
  AND linkedin_url IS NOT NULL
ORDER BY created_at ASC;

CREATE OR REPLACE VIEW v_queue_scoring AS
SELECT id, full_name, linkedin_url, email, company, job_title, linkedin_headline, linkedin_description, enrichment_status, created_at
FROM warm_outbound_staging
WHERE fit_score IS NULL
  AND enrichment_status IN ('enriched', 'pending_linkedin_dm', 'ready')
  AND archived_at IS NULL
  AND automation_paused = false
  AND full_name IS NOT NULL
ORDER BY created_at ASC;

CREATE OR REPLACE VIEW v_queue_drafting AS
SELECT id, full_name, linkedin_url, email, company, job_title, linkedin_headline, linkedin_description, fit_score, cohort_label, source, created_at
FROM warm_outbound_staging
WHERE fit_score >= 60
  AND first_touch_draft_body IS NULL
  AND enrichment_status IN ('enriched', 'pending_linkedin_dm', 'ready')
  AND archived_at IS NULL
  AND automation_paused = false
ORDER BY fit_score DESC, created_at ASC;

CREATE OR REPLACE VIEW v_queue_dm_dispatch AS
SELECT id, full_name, linkedin_url, email, company, fit_score, dm_draft_body, first_touch_draft_body, cohort_label, source
FROM warm_outbound_staging
WHERE first_touch_draft_body IS NOT NULL
  AND dm_connection_request_sent_at IS NULL
  AND send_message_id IS NULL
  AND archived_at IS NULL
  AND automation_paused = false
  AND is_paying_customer = false
  AND linkedin_url IS NOT NULL
  AND (dm_status IS NULL OR dm_status NOT IN ('sent_manual','disqualified','warm_queued','connect_request_queued','sent_manual_backfilled'))
ORDER BY fit_score DESC NULLS LAST, created_at ASC;

CREATE OR REPLACE VIEW v_queue_warm_dm AS
SELECT id, full_name, linkedin_url, email, company, fit_score, dm_draft_body, first_touch_draft_body, cohort_label, source
FROM warm_outbound_staging
WHERE first_touch_draft_body IS NOT NULL
  AND dm_first_message_sent_at IS NULL
  AND dm_status = 'warm_queued'
  AND archived_at IS NULL
  AND automation_paused = false
  AND linkedin_url IS NOT NULL
ORDER BY fit_score DESC NULLS LAST, created_at ASC;

CREATE OR REPLACE VIEW v_queue_followup AS
SELECT id, full_name, linkedin_url, email, company, fit_score, dm_connection_accepted_at, first_touch_draft_body, cohort_label,
  EXTRACT(EPOCH FROM (NOW() - dm_connection_accepted_at)) / 86400 AS days_since_accepted
FROM warm_outbound_staging
WHERE dm_connection_accepted_at IS NOT NULL
  AND dm_first_message_sent_at IS NULL
  AND archived_at IS NULL
ORDER BY dm_connection_accepted_at ASC;

CREATE OR REPLACE VIEW v_pipeline_queue_summary AS
SELECT
  (SELECT COUNT(*) FROM v_queue_enrichment)  AS q_enrichment,
  (SELECT COUNT(*) FROM v_queue_scoring)     AS q_scoring,
  (SELECT COUNT(*) FROM v_queue_drafting)    AS q_drafting,
  (SELECT COUNT(*) FROM v_queue_dm_dispatch) AS q_dm_dispatch,
  (SELECT COUNT(*) FROM v_queue_warm_dm)     AS q_warm_dm,
  (SELECT COUNT(*) FROM v_queue_followup)    AS q_followup;
