
-- Track which sources have credentials configured. Operator-visible.
CREATE TABLE IF NOT EXISTS fda_source_status (
  source_key TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  is_configured BOOLEAN NOT NULL DEFAULT FALSE,
  last_run_at TIMESTAMPTZ,
  last_run_result JSONB,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO fda_source_status (source_key, source_name, is_configured, notes) VALUES
  ('fda_warning_letters_drupal', 'FDA Warning Letters (Drupal datatables endpoint)', TRUE, 'Public endpoint, no auth required. Returns 3,400+ historical letters.'),
  ('fda_recalls_openfda', 'FDA Recalls (openFDA Enforcement Reports)', TRUE, 'Public endpoint. Drug + Device + Food.'),
  ('fda_inspections_dashboard', 'FDA Inspections Classifications (datadashboard API)', FALSE, 'REQUIRES CREDENTIALS. Email FDADataDashboard@fda.hhs.gov for an Authorization-Key. Once received, set FDA_DDAPI_USER and FDA_DDAPI_KEY in Supabase secrets.')
ON CONFLICT (source_key) DO UPDATE SET
  source_name = EXCLUDED.source_name,
  notes = EXCLUDED.notes,
  updated_at = NOW();
