-- Backfill case_file_interest from job title keywords
-- Priority order: most specific first
UPDATE warm_outbound_staging
SET case_file_interest = 'CAPA Effectiveness'
WHERE (case_file_interest IS NULL OR case_file_interest = '')
  AND archived_at IS NULL
  AND (job_title ILIKE '%capa%' OR job_title ILIKE '%corrective%action%');

UPDATE warm_outbound_staging
SET case_file_interest = 'Data Integrity'
WHERE (case_file_interest IS NULL OR case_file_interest = '')
  AND archived_at IS NULL
  AND (job_title ILIKE '%data integrity%' OR job_title ILIKE '%csv%' OR job_title ILIKE '%computer system valid%' OR job_title ILIKE '%21 cfr%' OR job_title ILIKE '%annex 11%');

UPDATE warm_outbound_staging
SET case_file_interest = 'Supplier Qualification'
WHERE (case_file_interest IS NULL OR case_file_interest = '')
  AND archived_at IS NULL
  AND (job_title ILIKE '%supplier%' OR job_title ILIKE '%vendor qual%' OR job_title ILIKE '%external manuf%');

UPDATE warm_outbound_staging
SET case_file_interest = 'Change Control Risk'
WHERE (case_file_interest IS NULL OR case_file_interest = '')
  AND archived_at IS NULL
  AND (job_title ILIKE '%change control%' OR job_title ILIKE '%regulatory affair%');

UPDATE warm_outbound_staging
SET case_file_interest = 'Process Validation'
WHERE (case_file_interest IS NULL OR case_file_interest = '')
  AND archived_at IS NULL
  AND (job_title ILIKE '%validation%' OR job_title ILIKE '%CSV%' OR job_title ILIKE '%qualification%');

UPDATE warm_outbound_staging
SET case_file_interest = 'Complaint Investigation'
WHERE (case_file_interest IS NULL OR case_file_interest = '')
  AND archived_at IS NULL
  AND (job_title ILIKE '%complaint%' OR job_title ILIKE '%post market%' OR job_title ILIKE '%pharmacovig%');

UPDATE warm_outbound_staging
SET case_file_interest = 'Stability OOT'
WHERE (case_file_interest IS NULL OR case_file_interest = '')
  AND archived_at IS NULL
  AND (job_title ILIKE '%stability%' OR job_title ILIKE '%analytical%');

UPDATE warm_outbound_staging
SET case_file_interest = 'OOS Investigation'
WHERE (case_file_interest IS NULL OR case_file_interest = '')
  AND archived_at IS NULL
  AND (job_title ILIKE '%qc%' OR job_title ILIKE '%quality control%' OR job_title ILIKE '%lab%');

UPDATE warm_outbound_staging
SET case_file_interest = 'Batch Release Authorization'
WHERE (case_file_interest IS NULL OR case_file_interest = '')
  AND archived_at IS NULL
  AND (job_title ILIKE '%manufactur%' OR job_title ILIKE '%production%' OR job_title ILIKE '%release%' OR job_title ILIKE '%batch%');

-- Default for QA Director/Head/VP roles → Deviation Root Cause (most universal)
UPDATE warm_outbound_staging
SET case_file_interest = 'Deviation Root Cause'
WHERE (case_file_interest IS NULL OR case_file_interest = '')
  AND archived_at IS NULL
  AND (job_title ILIKE '%qa%' OR job_title ILIKE '%quality assurance%' OR job_title ILIKE '%head of quality%' OR job_title ILIKE '%vp quality%' OR job_title ILIKE '%director%quality%' OR job_title ILIKE '%quality%head%');