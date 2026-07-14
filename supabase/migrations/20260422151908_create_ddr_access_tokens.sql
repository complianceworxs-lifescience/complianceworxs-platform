CREATE TABLE IF NOT EXISTS public.ddr_access_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  full_name TEXT,
  source TEXT NOT NULL DEFAULT 'stripe',
  stripe_session_id TEXT,
  stripe_customer_id TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '365 days',
  revoked_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ddr_access_tokens_token ON public.ddr_access_tokens(token);
CREATE INDEX IF NOT EXISTS idx_ddr_access_tokens_email ON public.ddr_access_tokens(email);
CREATE INDEX IF NOT EXISTS idx_ddr_access_tokens_expires ON public.ddr_access_tokens(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ddr_access_tokens_stripe ON public.ddr_access_tokens(stripe_session_id);

COMMENT ON TABLE public.ddr_access_tokens IS 'Access tokens for /ddr/ pages. Issued on Stripe purchase of $297 bundle OR manually by admin for partners/demos.';
COMMENT ON COLUMN public.ddr_access_tokens.source IS 'stripe | admin | partner — how the token was issued';
COMMENT ON COLUMN public.ddr_access_tokens.revoked_at IS 'If set, token is invalid regardless of expires_at. Used for refunds or compromised tokens.';