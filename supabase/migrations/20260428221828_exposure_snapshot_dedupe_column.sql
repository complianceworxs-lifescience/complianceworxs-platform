-- Plain text column, written by the function. Uniqueness enforced at insert.
ALTER TABLE exposure_snapshot_tokens
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_exposure_dedupe_key
  ON exposure_snapshot_tokens(dedupe_key)
  WHERE dedupe_key IS NOT NULL;