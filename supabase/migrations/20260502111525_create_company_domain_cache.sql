CREATE TABLE IF NOT EXISTS public.company_domain_cache (
  id BIGSERIAL PRIMARY KEY,
  company_name_normalized TEXT UNIQUE NOT NULL,
  company_name TEXT NOT NULL,
  domain TEXT,
  resolution_method TEXT,
  resolved_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  hit_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_company_domain_cache_normalized 
  ON public.company_domain_cache(company_name_normalized);
  
COMMENT ON TABLE public.company_domain_cache IS 
  'Cache of company name -> domain resolutions. Avoids repeated Claude web searches for the same companies.';