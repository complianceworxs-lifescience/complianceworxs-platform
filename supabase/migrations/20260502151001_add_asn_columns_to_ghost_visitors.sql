-- Add ASN / org columns from free IP lookup
ALTER TABLE ghost_visitors
  ADD COLUMN IF NOT EXISTS asn_org text,
  ADD COLUMN IF NOT EXISTS asn_number text,
  ADD COLUMN IF NOT EXISTS asn_type text,            -- 'isp','hosting','business','education','government'
  ADD COLUMN IF NOT EXISTS reverse_dns text,
  ADD COLUMN IF NOT EXISTS asn_lookup_at timestamptz,
  ADD COLUMN IF NOT EXISTS asn_lookup_status text;   -- 'success','failed','skipped_bot'

CREATE INDEX IF NOT EXISTS idx_ghost_visitors_asn_lookup ON ghost_visitors(asn_lookup_at) WHERE asn_lookup_at IS NULL;