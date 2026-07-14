ALTER TABLE public.partner_applications
ADD COLUMN IF NOT EXISTS primary_market TEXT;

CREATE INDEX IF NOT EXISTS idx_partner_applications_primary_market
ON public.partner_applications(primary_market);

COMMENT ON COLUMN public.partner_applications.primary_market IS 'Industry market the partner primarily serves: pharma | food | cosmetics_waitlist | multiple | other';