-- v_dm_track_priority: top of the LinkedIn DM queue Jon needs to act on manually
-- Pharma/biotech/cdmo first (Jon's vertical), then everyone else at fit >= 80
CREATE OR REPLACE VIEW v_dm_track_priority AS
SELECT
  id,
  full_name,
  company,
  job_title,
  linkedin_url,
  fit_score,
  industry,
  role_seniority,
  linkedin_connection_degree,
  CASE
    WHEN industry IN ('pharma','biotech','cdmo') AND fit_score >= 80 THEN 'TIER_1_PHARMA_EXEC'
    WHEN industry IN ('pharma','biotech','cdmo') AND fit_score >= 60 THEN 'TIER_2_PHARMA'
    WHEN fit_score >= 80 THEN 'TIER_3_OTHER_VERTICAL'
    ELSE 'TIER_4_BELOW_THRESHOLD'
  END AS tier
FROM warm_outbound_staging
WHERE enrichment_status = 'pending_linkedin_dm'
  AND automation_paused = false
  AND linkedin_url IS NOT NULL
  AND dm_connection_request_sent_at IS NULL
  AND fit_score IS NOT NULL
ORDER BY
  CASE
    WHEN industry IN ('pharma','biotech','cdmo') AND fit_score >= 80 THEN 1
    WHEN industry IN ('pharma','biotech','cdmo') AND fit_score >= 60 THEN 2
    WHEN fit_score >= 80 THEN 3
    ELSE 4
  END,
  fit_score DESC NULLS LAST,
  id DESC;

COMMENT ON VIEW v_dm_track_priority IS
  'Top of the LinkedIn DM queue for Jon to act on manually. Tier 1 = pharma/biotech/cdmo exec at fit 80+. Refreshed automatically as lead-fit-scorer scores DM-track leads.';