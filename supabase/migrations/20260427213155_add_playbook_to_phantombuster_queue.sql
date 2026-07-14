
-- System-wide kill switch for outbound sending (set to true Wednesday morning)
CREATE TABLE IF NOT EXISTS system_flags (
  flag_key TEXT PRIMARY KEY,
  flag_value BOOLEAN NOT NULL,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_flags (flag_key, flag_value, notes) VALUES
  ('linkedin_outbound_enabled', FALSE, 'Master kill switch for LinkedIn DM sending. Currently disabled due to Phantombuster account-disconnection pause until 2026-04-29.'),
  ('playbook_auto_send_enabled', FALSE, 'When TRUE, queued playbook touches flow into the Phantombuster CSV queue automatically. When FALSE, they sit in playbook_touch_queue awaiting a manual flip.')
ON CONFLICT (flag_key) DO NOTHING;

-- Replace the DM queue view to include playbook touches (gated by the flag)
CREATE OR REPLACE VIEW phantombuster_dm_queue AS
WITH already_touched AS (
  SELECT DISTINCT LOWER(target_linkedin) AS url
  FROM outreach_touches
  WHERE channel = 'linkedin_dm' AND target_linkedin IS NOT NULL
),
flags AS (
  SELECT
    COALESCE((SELECT flag_value FROM system_flags WHERE flag_key = 'linkedin_outbound_enabled'), FALSE) AS outbound_enabled,
    COALESCE((SELECT flag_value FROM system_flags WHERE flag_key = 'playbook_auto_send_enabled'), FALSE) AS playbook_send_enabled
),
-- HIGHEST PRIORITY: approved playbook touches in queue
playbook_queued AS (
  SELECT
    ptq.target_company AS full_name_company_fallback,
    COALESCE(ptq.target_name, ptq.target_company) AS full_name,
    SPLIT_PART(COALESCE(ptq.target_name, ptq.target_company), ' ', 1) AS first_name,
    ptq.target_linkedin AS linkedin_url,
    ptq.target_company AS title,
    'playbook_' || ptq.variant_label AS source_cohort,
    -1 AS priority, -- highest priority, above welcomes
    NULL::INT AS word_count,
    ptq.message_rendered AS message
  FROM playbook_touch_queue ptq
  CROSS JOIN flags f
  WHERE ptq.status = 'queued'
    AND ptq.channel = 'linkedin_dm'
    AND ptq.target_linkedin IS NOT NULL
    AND f.outbound_enabled = TRUE
    AND f.playbook_send_enabled = TRUE
    AND LOWER(ptq.target_linkedin) NOT IN (SELECT url FROM already_touched)
),
approved_welcomes AS (
  SELECT
    NULL::TEXT AS full_name_company_fallback,
    full_name,
    first_name,
    profile_url AS linkedin_url,
    title,
    'linkedin_welcome_approved' AS source_cohort,
    0 AS priority,
    NULL::INT AS word_count,
    approved_message AS message
  FROM linkedin_welcome_pending
  CROSS JOIN flags f
  WHERE draft_status = 'approved' AND sent_at IS NULL
    AND f.outbound_enabled = TRUE
    AND LOWER(profile_url) NOT IN (SELECT url FROM already_touched)
),
prospect_commenters AS (
  SELECT 
    NULL::TEXT AS full_name_company_fallback,
    name AS full_name,
    SPLIT_PART(name, ' ', 1) AS first_name,
    linkedin_url,
    title,
    'linkedin_commenter_prospect' AS source_cohort,
    1 AS priority,
    word_count,
    name AS first_name_for_msg
  FROM linkedin_commenters lc
  CROSS JOIN flags f
  WHERE classification = 'prospect'
    AND linkedin_url IS NOT NULL
    AND f.outbound_enabled = TRUE
    AND LOWER(linkedin_url) NOT IN (SELECT url FROM already_touched)
),
warm_staging_leads AS (
  SELECT
    NULL::TEXT AS full_name_company_fallback,
    full_name,
    first_name,
    linkedin_url,
    job_title AS title,
    'warm_outbound_staging_' || cohort_label AS source_cohort,
    CASE WHEN cohort_label IN ('QA_LEADERSHIP', 'REGULATORY_AFFAIRS') THEN 2
         WHEN cohort_label IN ('GMP_COMPLIANCE', 'QUALITY_SYSTEMS', 'AUDIT') THEN 3
         ELSE 4 END AS priority,
    NULL::INT AS word_count,
    first_name AS first_name_for_msg
  FROM warm_outbound_staging wos
  CROSS JOIN flags f
  WHERE linkedin_url IS NOT NULL
    AND f.outbound_enabled = TRUE
    AND LOWER(linkedin_url) NOT IN (SELECT url FROM already_touched)
)
SELECT 
  full_name, first_name,
  linkedin_url AS profile_url,
  title, source_cohort, priority, word_count, message
FROM playbook_queued
UNION ALL
SELECT
  full_name, first_name, linkedin_url AS profile_url,
  title, source_cohort, priority, word_count, message
FROM approved_welcomes
UNION ALL
SELECT
  full_name, first_name, linkedin_url AS profile_url,
  title, source_cohort, priority, word_count,
  first_name_for_msg || E' \u2014 pulled the last 12 months of FDA 483 observations where the SOP was followed and the documentation was complete, but the decision rationale wasn''t reconstructable. The pattern is more consistent than I expected.\n\nWhen was the last time you saw a CAPA closure record that captured the decision logic \u2014 not just the signature?'
FROM (
  SELECT * FROM prospect_commenters
  UNION ALL
  SELECT * FROM warm_staging_leads
) combined
ORDER BY priority ASC, word_count DESC NULLS LAST, full_name;
