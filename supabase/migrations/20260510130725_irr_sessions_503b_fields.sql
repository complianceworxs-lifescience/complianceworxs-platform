-- Add 503B-specific fields to irr_sessions per 503B IRR spec
-- These fields are nullable so existing pharma/food/cosmetics flow continues to work unchanged

-- Facility metadata
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS facility_name text;
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS fei_number text;
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS facility_role text;
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS sterile_operation_type text;

-- Event metadata extensions
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS lot_number text;
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS product_name text;
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS deviation_id text;
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS investigation_id text;
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS event_datetime timestamp with time zone;
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS release_date date;

-- Authorization metadata extensions
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS approving_role text;
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS review_participants text;
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS escalation_chain text;

-- Regulatory anchors selected by user (jsonb array of strings)
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS regulatory_anchors jsonb DEFAULT '[]'::jsonb;

-- Document attachment metadata (jsonb array of {name, size, type, storage_path})
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS attached_documents jsonb DEFAULT '[]'::jsonb;

-- Risk evaluation fields (Section 4 in spec)
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS contamination_risk_assessment text;
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS alternatives_considered text;
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS residual_risk_accepted text;

-- Pricing tier tracking
ALTER TABLE public.irr_sessions ADD COLUMN IF NOT EXISTS price_cents integer DEFAULT 29700;

-- Index for industry filtering (used in admin queries)
CREATE INDEX IF NOT EXISTS idx_irr_sessions_industry ON public.irr_sessions(industry);
CREATE INDEX IF NOT EXISTS idx_irr_sessions_paid_industry ON public.irr_sessions(paid, industry) WHERE paid = true;
