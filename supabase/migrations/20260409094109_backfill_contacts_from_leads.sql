
-- Step 1a: Backfill contacts from leads (real leads only, deduped by email)
INSERT INTO contacts (
  email,
  normalized_email,
  full_name,
  company,
  job_title,
  lifecycle_stage,
  consent_status,
  consent_source,
  created_at,
  updated_at
)
SELECT DISTINCT ON (lower(trim(email)))
  email,
  lower(trim(email)) AS normalized_email,
  NULLIF(trim(name), '')    AS full_name,
  NULLIF(trim(company), '') AS company,
  NULLIF(trim(title), '')   AS job_title,
  'lead'                    AS lifecycle_stage,
  'implied'                 AS consent_status,
  source                    AS consent_source,
  created_at,
  NOW()                     AS updated_at
FROM leads
WHERE email IS NOT NULL
  AND email NOT LIKE '%test%'
  AND email NOT LIKE '%example%'
  AND email NOT LIKE '%zapier%'
ORDER BY lower(trim(email)), created_at ASC
ON CONFLICT (email) DO NOTHING;

-- Step 1b: Also insert Carissa from purchases (buyer, not in leads)
INSERT INTO contacts (
  email,
  normalized_email,
  full_name,
  company,
  lifecycle_stage,
  consent_status,
  consent_source,
  created_at,
  updated_at
)
SELECT
  p.email,
  lower(trim(p.email)) AS normalized_email,
  NULL AS full_name,
  NULL AS company,
  'buyer' AS lifecycle_stage,
  'implied' AS consent_status,
  'stripe_purchase' AS consent_source,
  p.purchased_at,
  NOW()
FROM purchases p
WHERE p.email NOT IN ('unknown')
  AND p.email NOT LIKE '%test%'
ON CONFLICT (email) DO UPDATE
  SET lifecycle_stage = 'buyer', updated_at = NOW();
