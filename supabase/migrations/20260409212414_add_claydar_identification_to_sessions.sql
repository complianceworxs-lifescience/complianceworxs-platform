
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS identified_company        TEXT,
  ADD COLUMN IF NOT EXISTS identified_company_domain TEXT,
  ADD COLUMN IF NOT EXISTS claydar_identified_at     TIMESTAMPTZ;

COMMENT ON COLUMN sessions.identified_company        IS 'Company name identified by Claydar from IP lookup';
COMMENT ON COLUMN sessions.identified_company_domain IS 'Company domain identified by Claydar from IP lookup';
COMMENT ON COLUMN sessions.claydar_identified_at     IS 'Timestamp when Claydar identified this session';
