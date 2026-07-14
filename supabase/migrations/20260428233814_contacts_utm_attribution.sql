-- Add UTM attribution columns to contacts
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS first_utm_source text,
  ADD COLUMN IF NOT EXISTS first_utm_medium text,
  ADD COLUMN IF NOT EXISTS first_utm_campaign text,
  ADD COLUMN IF NOT EXISTS first_referrer text,
  ADD COLUMN IF NOT EXISTS last_utm_source text,
  ADD COLUMN IF NOT EXISTS last_utm_medium text,
  ADD COLUMN IF NOT EXISTS last_utm_campaign text,
  ADD COLUMN IF NOT EXISTS last_referrer text;

CREATE INDEX IF NOT EXISTS idx_contacts_first_utm_source ON contacts(first_utm_source) WHERE first_utm_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_first_utm_campaign ON contacts(first_utm_campaign) WHERE first_utm_campaign IS NOT NULL;