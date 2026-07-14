
ALTER TABLE contacts 
  ADD COLUMN IF NOT EXISTS attio_person_id TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_attio_person_id ON contacts(attio_person_id) WHERE attio_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_linkedin_url ON contacts(LOWER(linkedin_url)) WHERE linkedin_url IS NOT NULL;
