-- ====================================================================
-- LEAD CSV INGEST INFRASTRUCTURE
-- Audit log of every CSV upload + editable ICP qualification rules
-- ====================================================================

-- 1) Audit log: every upload, what it contained, what made it through
CREATE TABLE IF NOT EXISTS lead_ingest_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- request metadata
  source_label TEXT NOT NULL,              -- e.g. 'phantombuster_post_engagers_2026_05_04'
  cohort_label TEXT,                       -- e.g. 'post_engager_may4'
  uploaded_by TEXT,                        -- 'jon' or system identifier
  csv_filename TEXT,                       -- original filename if provided
  csv_row_count INTEGER NOT NULL,          -- raw rows in CSV
  
  -- pipeline counts
  rows_parsed INTEGER NOT NULL DEFAULT 0,
  rows_internal_duplicates INTEGER NOT NULL DEFAULT 0,
  rows_already_in_staging INTEGER NOT NULL DEFAULT 0,
  rows_already_in_contacts INTEGER NOT NULL DEFAULT 0,
  rows_excluded_competitor INTEGER NOT NULL DEFAULT 0,
  rows_excluded_non_icp_company INTEGER NOT NULL DEFAULT 0,
  rows_excluded_non_icp_role INTEGER NOT NULL DEFAULT 0,
  rows_excluded_missing_data INTEGER NOT NULL DEFAULT 0,
  rows_loaded_to_staging INTEGER NOT NULL DEFAULT 0,
  
  -- detail breakdowns (jsonb for flexibility)
  exclusion_reasons JSONB,                 -- {"reason": count, ...}
  loaded_lead_ids INTEGER[],               -- ids inserted into warm_outbound_staging
  excluded_sample JSONB,                   -- sample of excluded rows for review
  
  -- diagnostics
  detected_format TEXT,                    -- 'phantombuster_sales_nav', 'apollo_csv', 'phantombuster_profile_scraper', 'unknown'
  column_mapping JSONB,                    -- which CSV columns mapped to which fields
  parse_errors JSONB,                      -- rows that failed to parse
  duration_ms INTEGER,
  
  -- result
  status TEXT NOT NULL,                    -- 'success', 'partial', 'failed'
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_lead_ingest_log_created ON lead_ingest_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_ingest_log_source ON lead_ingest_log(source_label);

COMMENT ON TABLE lead_ingest_log IS 'Audit log of every CSV upload through lead-csv-ingest. One row per upload.';

-- 2) Editable qualification rules — controls who is ICP without code changes
CREATE TABLE IF NOT EXISTS lead_csv_qualification_rules (
  id BIGSERIAL PRIMARY KEY,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('exclude_company', 'include_company', 'include_role_keyword', 'exclude_role_keyword')),
  pattern TEXT NOT NULL,                   -- ILIKE pattern, e.g. '%MasterControl%'
  reason TEXT,                             -- human-readable explanation
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_qual_rules_type_pattern 
  ON lead_csv_qualification_rules (rule_type, pattern);

COMMENT ON TABLE lead_csv_qualification_rules IS 'ICP qualification rules. Edit rows here to change ingest behavior without redeploying code.';

-- 3) Seed initial rules from what we just learned manually

-- EXCLUDE COMPANIES (competitors and non-ICP)
INSERT INTO lead_csv_qualification_rules (rule_type, pattern, reason) VALUES
  ('exclude_company', '%MasterControl%', 'Direct competitor - vendor staff'),
  ('exclude_company', '%Veeva%', 'Direct competitor - vendor staff'),
  ('exclude_company', '%TrackWise%', 'Direct competitor - vendor staff'),
  ('exclude_company', '%Sparta Systems%', 'Direct competitor - vendor staff'),
  ('exclude_company', '%ETQ%', 'Direct competitor - vendor staff'),
  ('exclude_company', '%Greenlight Guru%', 'Direct competitor - vendor staff'),
  ('exclude_company', '%Qualio%', 'Direct competitor - vendor staff'),
  ('exclude_company', '%Zoolatech%', 'Vendor contractor - works for MasterControl'),
  ('exclude_company', '%Jamieson Wellness%', 'Consumer supplements - not FDA-regulated pharma'),
  ('exclude_company', '%Young Living%', 'MLM essential oils - not ICP'),
  ('exclude_company', '%Hyatt%', 'Hospitality - not ICP'),
  ('exclude_company', '%Hilton%', 'Hospitality - not ICP'),
  ('exclude_company', '%Marriott%', 'Hospitality - not ICP'),
  ('exclude_company', '%KW Realty%', 'Real estate - not ICP'),
  ('exclude_company', '%Visit Salt Lake%', 'Tourism - not ICP'),
  ('exclude_company', '%USA Rugby%', 'Sports - not ICP'),
  ('exclude_company', '%Alpine School District%', 'K-12 education - not ICP'),
  ('exclude_company', '%Commercial Bank%', 'Banking - not ICP'),
  ('exclude_company', '%ADP%', 'HR/payroll - not ICP'),
  ('exclude_company', '%USI Insurance%', 'Insurance - not ICP'),
  ('exclude_company', '%Farm Bureau%', 'Insurance - not ICP'),
  ('exclude_company', '%Vexcel Data%', 'Aerial imagery - not ICP'),
  ('exclude_company', '%Apollo.io%', 'Sales tools - not ICP'),
  ('exclude_company', '%Outreach.io%', 'Sales tools - not ICP'),
  ('exclude_company', '%Salesloft%', 'Sales tools - not ICP'),
  ('exclude_company', '%LinkedIn Corp%', 'LinkedIn employees - not ICP');

-- INCLUDE COMPANIES (named ICP - pharma, biotech, medical device)
INSERT INTO lead_csv_qualification_rules (rule_type, pattern, reason) VALUES
  ('include_company', '%pharma%', 'Pharma keyword'),
  ('include_company', '%biotech%', 'Biotech keyword'),
  ('include_company', '%bioscience%', 'Bioscience keyword'),
  ('include_company', '%biologics%', 'Biologics keyword'),
  ('include_company', '%therapeutics%', 'Therapeutics keyword'),
  ('include_company', '%medical%', 'Medical keyword'),
  ('include_company', '%healthcare%', 'Healthcare keyword'),
  ('include_company', '%clinical%', 'Clinical keyword'),
  ('include_company', '%diagnostics%', 'Diagnostics keyword'),
  ('include_company', '%laboratories%', 'Lab keyword'),
  ('include_company', '%lifesci%', 'Life sciences keyword'),
  ('include_company', '%life sciences%', 'Life sciences keyword'),
  ('include_company', '%Astellas%', 'Named ICP - large pharma'),
  ('include_company', '%Bavarian Nordic%', 'Named ICP - vaccine biotech'),
  ('include_company', '%WuXi%', 'Named ICP - CDMO'),
  ('include_company', '%Abbott%', 'Named ICP - medical device + pharma'),
  ('include_company', '%Solvias%', 'Named ICP - pharma analytics'),
  ('include_company', '%Repligen%', 'Named ICP - bioprocessing'),
  ('include_company', '%Codexis%', 'Named ICP - biocatalysis'),
  ('include_company', '%Tiofarma%', 'Named ICP - pharma'),
  ('include_company', '%Pharmathen%', 'Named ICP - pharma'),
  ('include_company', '%Kashiv%', 'Named ICP - pharma'),
  ('include_company', '%Kedrion%', 'Named ICP - pharma'),
  ('include_company', '%LORENZ Life Sciences%', 'Named ICP - reg software'),
  ('include_company', '%NAMSA%', 'Named ICP - medical device CRO'),
  ('include_company', '%Streck%', 'Named ICP - in vitro diagnostics'),
  ('include_company', '%Zoetis%', 'Named ICP - animal health pharma'),
  ('include_company', '%Fagron%', 'Named ICP - sterile compounding'),
  ('include_company', '%Axolabs%', 'Named ICP - oligonucleotide'),
  ('include_company', '%Wells Pharma%', 'Named ICP - pharma'),
  ('include_company', '%BAP Pharma%', 'Named ICP - pharma'),
  ('include_company', '%Pharmatek%', 'Named ICP - pharma services'),
  ('include_company', '%NeoGenomics%', 'Named ICP - cancer diagnostics'),
  ('include_company', '%Keenova%', 'Named ICP - eQMS specialist'),
  ('include_company', '%LabInformatics%', 'Named ICP - LIMS/CSV'),
  ('include_company', '%SmartCella%', 'Named ICP - medical device'),
  ('include_company', '%ACP - Accelerated Care%', 'Named ICP - long-term care/healthcare'),
  ('include_company', '%PCI Pharma%', 'Named ICP - CDMO'),
  ('include_company', '%Carnegie Pharmaceuticals%', 'Named ICP - pharma'),
  ('include_company', '%Wellington Foods%', 'Named ICP - contract manufacturer'),
  ('include_company', '%Wilmington PharmaTech%', 'Named ICP - pharma'),
  ('include_company', '%Precision Dose%', 'Named ICP - pharma packaging'),
  ('include_company', '%Rephine%', 'Named ICP - pharma audit'),
  ('include_company', '%SeerPharma%', 'Named ICP - pharma consulting'),
  ('include_company', '%Bosch Healthcare%', 'Named ICP - medical device'),
  ('include_company', '%Sunrise Medical%', 'Named ICP - medical device'),
  ('include_company', '%Oliver Healthcare%', 'Named ICP - medical packaging'),
  ('include_company', '%Nordic Bioscience%', 'Named ICP - pharma research'),
  ('include_company', '%Merge Healthcare%', 'Named ICP - medical imaging');

-- INCLUDE ROLE KEYWORDS (compliance/quality/regulatory titles)
INSERT INTO lead_csv_qualification_rules (rule_type, pattern, reason) VALUES
  ('include_role_keyword', '%quality%', 'QA/QC role'),
  ('include_role_keyword', '%QA%', 'QA role'),
  ('include_role_keyword', '%QC%', 'QC role'),
  ('include_role_keyword', '%validation%', 'Validation role'),
  ('include_role_keyword', '%CSV%', 'Computer System Validation'),
  ('include_role_keyword', '%compliance%', 'Compliance role'),
  ('include_role_keyword', '%regulatory%', 'Regulatory affairs'),
  ('include_role_keyword', '%document control%', 'Document control'),
  ('include_role_keyword', '%QMS%', 'QMS administrator'),
  ('include_role_keyword', '%eQMS%', 'eQMS specialist'),
  ('include_role_keyword', '%GMP%', 'GMP role'),
  ('include_role_keyword', '%GxP%', 'GxP role'),
  ('include_role_keyword', '%audit%', 'Audit role'),
  ('include_role_keyword', '%inspection%', 'Inspection role'),
  ('include_role_keyword', '%CAPA%', 'CAPA management'),
  ('include_role_keyword', '%deviation%', 'Deviation management'),
  ('include_role_keyword', '%manufacturing%', 'Mfg ops - tangentially relevant'),
  ('include_role_keyword', '%Annex 11%', 'EU compliance'),
  ('include_role_keyword', '%21 CFR%', 'FDA compliance');

-- EXCLUDE ROLE KEYWORDS (clearly non-buyer roles even at ICP companies)
INSERT INTO lead_csv_qualification_rules (rule_type, pattern, reason) VALUES
  ('exclude_role_keyword', '%intern%', 'Intern - no buying authority'),
  ('exclude_role_keyword', '%student%', 'Student - no buying authority'),
  ('exclude_role_keyword', '%retired%', 'Retired'),
  ('exclude_role_keyword', '%recruiter%', 'Recruiter at ICP company - not buyer');

SELECT 'Infrastructure created' AS status,
  (SELECT COUNT(*) FROM lead_csv_qualification_rules) AS rules_seeded;