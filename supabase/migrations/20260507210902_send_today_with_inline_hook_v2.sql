DROP VIEW IF EXISTS send_today CASCADE;

CREATE VIEW send_today AS
WITH cooled AS (
  SELECT 
    s.id AS staging_id,
    s.full_name,
    s.first_name,
    s.company,
    s.job_title,
    s.linkedin_url,
    s.email,
    s.attio_record_id,
    s.fit_score,
    s.role_function,
    s.case_file_interest,
    CASE 
      WHEN s.linkedin_url IS NOT NULL THEN 'linkedin_dm'
      WHEN s.email IS NOT NULL THEN 'email'
      ELSE NULL
    END AS recommended_channel,
    COALESCE((SELECT count(*) FROM outbound_log o WHERE o.staging_id = s.id), 0) + 1 AS next_touch,
    (SELECT MAX(sent_at) FROM outbound_log o WHERE o.staging_id = s.id) AS last_sent_at,
    EXTRACT(epoch FROM (NOW() - (SELECT MAX(sent_at) FROM outbound_log o WHERE o.staging_id = s.id)))/86400 AS days_since_touch,
    -- target_account_priority is text: 'high'/'medium'/'low'/null
    CASE LOWER(COALESCE(s.target_account_priority, ''))
      WHEN 'high' THEN 3
      WHEN 'medium' THEN 2
      WHEN 'low' THEN 1
      ELSE 0
    END AS company_priority,
    LOWER(COALESCE(
      NULLIF(split_part(s.email, '@', 2), ''),
      s.company_domain,
      s.company
    )) AS domain_key
  FROM warm_outbound_staging s
  WHERE 
    s.archived_at IS NULL
    AND s.replied_at IS NULL
    AND s.fit_score >= 75
    AND COALESCE(s.last_attio_status, '') NOT IN ('Disqualified', 'Purchased')
    AND (s.linkedin_url IS NOT NULL OR s.email IS NOT NULL)
    AND (s.automation_paused IS NULL OR s.automation_paused = false)
),
ranked AS (
  SELECT *,
    CASE
      WHEN last_sent_at IS NULL THEN true
      WHEN recommended_channel = 'linkedin_dm' AND days_since_touch >= 3 THEN true
      WHEN recommended_channel = 'email' AND days_since_touch >= 4 THEN true
      ELSE false
    END AS due_to_send,
    CASE 
      WHEN next_touch > 3 AND days_since_touch < 90 THEN false
      ELSE true
    END AS within_touch_cap,
    ROW_NUMBER() OVER (
      PARTITION BY domain_key 
      ORDER BY company_priority DESC, fit_score DESC, staging_id ASC
    ) AS domain_rank,
    company_priority * 1000 + fit_score AS priority_score
  FROM cooled
),
eligible AS (
  SELECT * FROM ranked
  WHERE due_to_send = true
    AND within_touch_cap = true
    AND domain_rank = 1
),
with_hook AS (
  SELECT *,
    CASE 
      WHEN case_file_interest ILIKE '%batch%release%' OR case_file_interest ILIKE '%release%authorization%' THEN
        first_name || ', when an FDA inspector asks who authorized a batch release during a deviation or with a borderline lab result, your team has to produce the decision logic on demand. At most sites the record doesn''t exist until you build it under questioning. That gap is what I work on.'
      WHEN case_file_interest ILIKE '%deviation%' OR case_file_interest ILIKE '%root%cause%' THEN
        first_name || ', when an FDA inspector asks how you concluded a deviation was non-recurring, your team has to reconstruct the rationale from emails and meeting notes. The signed deviation form isn''t the authorization record. That gap is what I work on.'
      WHEN case_file_interest ILIKE '%capa%' THEN
        first_name || ', when an FDA inspector asks how you proved a CAPA was effective — not just closed — most QA teams can''t produce the decision record on demand. The closure form isn''t the effectiveness rationale. That gap is what I work on.'
      WHEN case_file_interest ILIKE '%change%control%' THEN
        first_name || ', when an FDA inspector examines your change control decisions, they''re asking one question: who determined this was major vs minor vs non-reportable, and what was the documented basis? A signed change form is not a filing determination record. That gap is what I work on.'
      WHEN case_file_interest ILIKE '%oos%' OR case_file_interest ILIKE '%out%of%spec%' THEN
        first_name || ', when an FDA inspector asks how you justified an OOS invalidation, your team has to reconstruct the rationale post-hoc. The Phase II investigation report isn''t the authorization record for invalidation. That gap is what I work on.'
      WHEN case_file_interest ILIKE '%data%integrity%' THEN
        first_name || ', when an FDA inspector asks who authorized a data review exception or audit trail override, most teams can''t produce a contemporaneous record. The audit trail shows what happened, not who authorized the deviation from procedure. That gap is what I work on.'
      WHEN case_file_interest ILIKE '%supplier%' THEN
        first_name || ', when an FDA inspector asks how you qualified a supplier for a critical material — and what justified the risk classification — the audit report isn''t the authorization record. The decision logic behind the risk call is rarely captured. That gap is what I work on.'
      WHEN case_file_interest ILIKE '%stability%' OR case_file_interest ILIKE '%oot%' THEN
        first_name || ', when an FDA inspector asks how you concluded a stability OOT was non-significant, your team has to reconstruct the trend analysis logic. The data table isn''t the disposition rationale. That gap is what I work on.'
      WHEN case_file_interest ILIKE '%complaint%' THEN
        first_name || ', when an FDA inspector asks how you classified a complaint as non-reportable, the closure record isn''t the reportability decision. The logic behind that call is rarely captured at the moment. That gap is what I work on.'
      WHEN case_file_interest ILIKE '%process%validation%' THEN
        first_name || ', when an FDA inspector asks how you concluded process validation succeeded — not just that the protocol passed — the validation report isn''t the conclusion authorization. That gap is what I work on.'
      ELSE
        first_name || ', when an FDA inspector at ' || company || ' asks who authorized a critical compliance decision and on what basis, most QA teams can''t produce the record on demand. The signed form isn''t the authorization logic. That gap is what I work on.'
    END AS draft_hook,
    CASE 
      WHEN case_file_interest ILIKE '%batch%release%' THEN 'Batch Release Authorization'
      WHEN case_file_interest ILIKE '%deviation%' THEN 'Deviation Root Cause'
      WHEN case_file_interest ILIKE '%capa%' THEN 'CAPA Effectiveness'
      WHEN case_file_interest ILIKE '%change%control%' THEN 'Change Control Risk'
      WHEN case_file_interest ILIKE '%oos%' THEN 'OOS Investigation'
      WHEN case_file_interest ILIKE '%data%integrity%' THEN 'Data Integrity'
      WHEN case_file_interest ILIKE '%supplier%' THEN 'Supplier Qualification'
      WHEN case_file_interest ILIKE '%stability%' THEN 'Stability OOT'
      WHEN case_file_interest ILIKE '%complaint%' THEN 'Complaint Investigation'
      WHEN case_file_interest ILIKE '%process%validation%' THEN 'Process Validation'
      ELSE 'General Authorization Gap'
    END AS inspection_signal
  FROM eligible
)
SELECT 
  staging_id,
  full_name AS name,
  company,
  job_title AS title,
  linkedin_url,
  email,
  recommended_channel AS channel,
  fit_score,
  next_touch,
  last_sent_at AS last_contact,
  ROUND(days_since_touch::numeric, 1) AS days_since_last_contact,
  inspection_signal,
  draft_hook,
  attio_record_id,
  ROW_NUMBER() OVER (ORDER BY priority_score DESC, staging_id ASC) AS rank
FROM with_hook
ORDER BY rank
LIMIT 10;