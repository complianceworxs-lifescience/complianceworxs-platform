
ALTER TABLE exposure_snapshots ADD COLUMN IF NOT EXISTS public_slug text;

UPDATE exposure_snapshots SET public_slug = 'process-validation' WHERE case_file_slug = 'process-validation-conclusion';
UPDATE exposure_snapshots SET public_slug = 'deviation-root-cause' WHERE case_file_slug = 'deviation-root-cause';
UPDATE exposure_snapshots SET public_slug = 'oos-investigation' WHERE case_file_slug = 'oos-investigation';
UPDATE exposure_snapshots SET public_slug = 'deviation-risk-assessment' WHERE case_file_slug = 'deviation-risk-assessment';
UPDATE exposure_snapshots SET public_slug = 'change-control-risk' WHERE case_file_slug = 'change-control-risk';
UPDATE exposure_snapshots SET public_slug = 'capa-effectiveness' WHERE case_file_slug = 'capa-effectiveness';
UPDATE exposure_snapshots SET public_slug = 'data-integrity' WHERE case_file_slug = 'data-integrity';
UPDATE exposure_snapshots SET public_slug = 'supplier-qualification' WHERE case_file_slug = 'supplier-qualification';
UPDATE exposure_snapshots SET public_slug = 'stability-oot' WHERE case_file_slug = 'stability-oot';
UPDATE exposure_snapshots SET public_slug = 'complaint-investigation' WHERE case_file_slug = 'complaint-investigation';

CREATE INDEX IF NOT EXISTS idx_exposure_snapshots_public_slug ON exposure_snapshots (public_slug) WHERE page_active = true;
