-- Ghost visitors: PostHog visitors with IPs we haven't yet matched to a contact
CREATE TABLE IF NOT EXISTS ghost_visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  posthog_distinct_id text NOT NULL,
  ip_address text,
  ip_type text,                              -- 'tor', 'datacenter', 'residential', 'corporate', 'self'
  is_bot boolean DEFAULT false,
  city text,
  region text,
  country text,
  country_code text,
  pages_visited text[],
  page_count integer DEFAULT 0,
  case_files_viewed text[],
  hit_lock boolean DEFAULT false,
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL,
  enrichment_status text DEFAULT 'pending',  -- 'pending','identified','dead_end','disqualified'
  identified_company text,
  identified_company_domain text,
  attio_company_id text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (posthog_distinct_id)
);

CREATE INDEX IF NOT EXISTS idx_ghost_visitors_status ON ghost_visitors(enrichment_status);
CREATE INDEX IF NOT EXISTS idx_ghost_visitors_last_seen ON ghost_visitors(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_ghost_visitors_ip ON ghost_visitors(ip_address);
CREATE INDEX IF NOT EXISTS idx_ghost_visitors_country ON ghost_visitors(country_code);

COMMENT ON TABLE ghost_visitors IS 'PostHog visitor sessions synced into Supabase for identification. Each row = one distinct_id session.';