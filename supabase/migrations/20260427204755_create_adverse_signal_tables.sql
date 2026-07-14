
-- Watchlist of companies derived from leads/commenters/contacts
CREATE TABLE IF NOT EXISTS adverse_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  company_domain TEXT,
  source_type TEXT NOT NULL,
  related_contact_emails TEXT[],
  related_linkedin_urls TEXT[],
  related_attio_person_ids TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (normalized_name)
);
CREATE INDEX IF NOT EXISTS idx_adverse_watchlist_active ON adverse_watchlist(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_adverse_watchlist_normalized ON adverse_watchlist(normalized_name);

-- Raw scraped events from FDA sources (everything we ingest, watchlist or not)
CREATE TABLE IF NOT EXISTS adverse_events_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('fda_warning_letter', 'fda_recall', 'fda_inspection_classification', 'fda_import_alert', 'manual')),
  source_id TEXT NOT NULL,
  event_date DATE,
  company_name TEXT,
  normalized_company_name TEXT,
  product TEXT,
  classification TEXT,
  reason TEXT,
  url TEXT,
  raw_payload JSONB,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_adverse_events_raw_source ON adverse_events_raw(source, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_adverse_events_raw_company ON adverse_events_raw(normalized_company_name);

-- Signals = matched events (raw event + watchlist company match)
CREATE TABLE IF NOT EXISTS adverse_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_event_id UUID NOT NULL REFERENCES adverse_events_raw(id) ON DELETE CASCADE,
  watchlist_id UUID REFERENCES adverse_watchlist(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  company_name TEXT NOT NULL,
  event_date DATE,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  signal_type TEXT NOT NULL,
  recommended_action TEXT,
  asset_routing TEXT,
  surfaced_in_digest_at TIMESTAMPTZ,
  acted_on_at TIMESTAMPTZ,
  acted_on_by TEXT,
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adverse_signals_unactioned ON adverse_signals(created_at DESC) WHERE acted_on_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_adverse_signals_watchlist ON adverse_signals(watchlist_id) WHERE watchlist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_adverse_signals_severity ON adverse_signals(severity, event_date DESC);
