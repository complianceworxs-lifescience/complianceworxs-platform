ALTER TABLE warm_outbound_staging
ADD COLUMN IF NOT EXISTS outbound_action TEXT;

CREATE INDEX IF NOT EXISTS idx_warm_outbound_outbound_action
ON warm_outbound_staging (outbound_action)
WHERE outbound_action IS NOT NULL;

COMMENT ON COLUMN warm_outbound_staging.outbound_action IS
'v29 signal-or-silence routing flag. Values: NULL (default, email path), no_note_connect_only (no public signal found, route to manual LinkedIn blank connect, skip email send).';