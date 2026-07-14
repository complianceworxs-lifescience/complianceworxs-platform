ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS industry TEXT DEFAULT 'pharma';
CREATE INDEX IF NOT EXISTS idx_irr_sessions_industry ON public.irr_sessions(industry);
COMMENT ON COLUMN public.irr_sessions.industry IS 'Regulatory framework context: pharma | food | cosmetics. Defaults to pharma for backward compatibility.';