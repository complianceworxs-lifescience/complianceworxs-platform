-- View for the daily brief: leads needing follow-up today
CREATE OR REPLACE VIEW followup_due_today AS
SELECT 
  s.id AS staging_id,
  s.attio_record_id,
  s.first_name,
  s.last_name,
  s.first_name || ' ' || s.last_name AS full_name,
  s.email,
  s.company,
  s.company_domain,
  s.job_title,
  s.linkedin_url,
  s.case_file_interest,
  s.sequence_email_count,
  s.followup_stage,
  s.last_sequence_email_at,
  s.next_followup_due_at,
  EXTRACT(DAY FROM (NOW() - s.last_sequence_email_at))::INT AS days_since_last_email,
  cr.recent_fda_signals,
  cr.inspector_angle,
  cr.is_fda_regulated
FROM warm_outbound_staging s
LEFT JOIN companies_research cr 
  ON LOWER(cr.domain) = LOWER(REPLACE(REPLACE(s.company_domain, 'http://', ''), 'www.', ''))
WHERE s.archived_at IS NULL
  AND s.replied_at IS NULL
  AND COALESCE(s.automation_paused, false) = false
  AND s.next_followup_due_at IS NOT NULL
  AND s.next_followup_due_at <= NOW()
  AND s.email IS NOT NULL
ORDER BY s.next_followup_due_at ASC;

COMMENT ON VIEW followup_due_today IS 
'Leads where automation has flagged a follow-up email is due. Used by daily-brief-generator. Excludes replied, archived, and paused leads.';