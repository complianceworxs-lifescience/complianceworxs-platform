
-- View that produces the daily DM queue, deduped against everyone already touched
CREATE OR REPLACE VIEW phantombuster_dm_queue AS
WITH already_touched AS (
  SELECT DISTINCT LOWER(target_linkedin) AS url
  FROM outreach_touches
  WHERE channel = 'linkedin_dm'
    AND target_linkedin IS NOT NULL
),
prospect_commenters AS (
  SELECT 
    name AS full_name,
    SPLIT_PART(name, ' ', 1) AS first_name,
    linkedin_url,
    title,
    'linkedin_commenter_prospect' AS source_cohort,
    1 AS priority,
    word_count
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
    NULL::INT AS word_count
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
  -- Touch 1 message (reciprocity-first, no link, no attachment)
  first_name || E' \u2014 pulled the last 12 months of FDA 483 observations where the SOP was followed and the documentation was complete, but the decision rationale wasn''t reconstructable. The pattern is more consistent than I expected.\n\nWhen was the last time you saw a CAPA closure record that captured the decision logic \u2014 not just the signature?' AS message
FROM (
  SELECT * FROM prospect_commenters
  UNION ALL
  SELECT * FROM warm_staging_leads
) combined
ORDER BY priority ASC, word_count DESC NULLS LAST, full_name;

GRANT SELECT ON phantombuster_dm_queue TO anon, authenticated;
