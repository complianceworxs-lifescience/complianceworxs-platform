
ALTER TABLE partner_applications 
  ADD COLUMN IF NOT EXISTS company_url TEXT;
