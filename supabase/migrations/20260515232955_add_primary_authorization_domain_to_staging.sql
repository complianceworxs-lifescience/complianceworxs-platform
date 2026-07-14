-- Add primary_authorization_domain column to warm_outbound_staging
-- This tags every contact with the authorization domain they have the most exposure to
-- Used by first-touch-drafter for domain-aware copy generation

ALTER TABLE warm_outbound_staging
ADD COLUMN IF NOT EXISTS primary_authorization_domain TEXT
CHECK (primary_authorization_domain IN (
  'batch_release',
  'capa',
  'oos_oot',
  'deviation',
  'change_control',
  'data_integrity',
  'complaint',
  'visual_inspection',
  'bud',
  'supplier_qualification',
  'validation_exception'
));

CREATE INDEX IF NOT EXISTS idx_warm_outbound_staging_auth_domain
ON warm_outbound_staging(primary_authorization_domain);

COMMENT ON COLUMN warm_outbound_staging.primary_authorization_domain IS
'The authorization domain this contact has the most operational exposure to. Used by first-touch-drafter and DM drafter to write domain-specific copy. Backfilled from job title/role heuristics. NULL = not yet classified.';