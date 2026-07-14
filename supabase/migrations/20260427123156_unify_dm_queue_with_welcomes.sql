
CREATE OR REPLACE VIEW phantombuster_dm_queue AS
WITH already_touched AS (
  SELECT DISTINCT LOWER(target_linkedin) AS url
  FROM outreach_touches
  WHERE channel = 'linkedin_dm'
    AND target_linkedin IS NOT NULL
),
approved_welcomes AS (
  SELECT
    full_name,
    first_name,
    profile_url AS linkedin_url,
    title,
    'linkedin_welcome_approved' AS source_cohort,
    0 AS priority,
    NULL::INT AS word_count,
    approved_message AS message
  FROM linkedin_welcome_pending
  WHERE draft_status = 'approved'
    AND sent_at IS NULL
    AND LOWER(profile_url) NOT IN (SELECT url FROM already_touched)
),
prospect_commenters AS (
  SELECT 
    name AS full_name,
    SPLIT_PART(name, ' ', 1) AS first_name,
    linkedin_url,
    title,
    'linkedin_commenter_prospect' AS source_cohort,
    1 AS priority,
    word_count,
    name AS first_name_for_msg
  FROM linkedin_commenters
  WHERE classification = 'prospect'
    AND linkedin_url IS NOT NULL
    AND LOWER(linkedin_url) NOT IN (SELECT url FROM already_touched)
),
warm_staging_leads AS (
  SELECT
    full_name,
    first_name,
    linkedin_url,
    job_title AS title,
    'warm_outbound_staging_' || cohort_label AS source_cohort,
    CASE 
      WHEN cohort_label IN ('QA_LEADERSHIP', 'REGULATORY_AFFAIRS') THEN 2
      WHEN cohort_label IN ('GMP_COMPLIANCE', 'QUALITY_SYSTEMS', 'AUDIT') THEN 3
      ELSE 4
    END AS priority,
    NULL::INT AS word_count,
    first_name AS first_name_for_msg
  FROM warm_outbound_staging
  WHERE linkedin_url IS NOT NULL
    AND LOWER(linkedin_url) NOT IN (SELECT url FROM already_touched)
)
SELECT 
  full_name,
  first_name,
  linkedin_url AS profile_url,
  title,
  source_cohort,
  priority,
  word_count,
  message
FROM approved_welcomes
UNION ALL
SELECT
  full_name,
  first_name,
  linkedin_url AS profile_url,
  title,
  source_cohort,
  priority,
  word_count,
  first_name_for_msg || E' \u2014 pulled the last 12 months of FDA 483 observations where the SOP was followed and the documentation was complete, but the decision rationale wasn''t reconstructable. The pattern is more consistent than I expected.\n\nWhen was the last time you saw a CAPA closure record that captured the decision logic \u2014 not just the signature?' AS message
FROM (
  SELECT * FROM prospect_commenters
  UNION ALL
  SELECT * FROM warm_staging_leads
) combined
ORDER BY priority ASC, word_count DESC NULLS LAST, full_name;
