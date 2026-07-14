-- Registry mapping public pages → Stripe links → expected display price.
-- The page-price-audit edge function reads this and verifies:
--   1. Page HTML contains the Stripe link URL fragment
--   2. Page HTML contains the expected price string (e.g. "$875")
--   3. Stripe API charges that expected amount for the linked plink_id
-- Any mismatch = system_alerts row, surfaced in session briefing.

CREATE TABLE IF NOT EXISTS public.page_stripe_link_registry (
  id BIGSERIAL PRIMARY KEY,
  page_url TEXT NOT NULL,
  page_label TEXT NOT NULL,
  stripe_payment_link_id TEXT NOT NULL,
  stripe_link_url_fragment TEXT NOT NULL,
  expected_display_price TEXT NOT NULL,
  expected_amount_cents INTEGER NOT NULL,
  product_name TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_verified_at TIMESTAMPTZ,
  last_verification_result TEXT,
  CONSTRAINT page_link_unique UNIQUE (page_url, stripe_payment_link_id)
);

CREATE INDEX IF NOT EXISTS idx_page_stripe_active ON page_stripe_link_registry (is_active) WHERE is_active = TRUE;

-- Seed: bundle link must appear on all 10 case-file `/complete-file` pages + homepage
INSERT INTO page_stripe_link_registry 
  (page_url, page_label, stripe_payment_link_id, stripe_link_url_fragment, expected_display_price, expected_amount_cents, product_name, notes)
VALUES
  ('https://cases.complianceworxs.com/batch-record-review/complete-file',         'CF01 complete-file bundle CTA',        'plink_1TDpuBBcdOgm3yGBZ4FBke9W', '14AcN4coH607fWdabb2cg0N', '$875', 87500, 'The Compliance Executive Inspection Defense Series', 'all-10 bundle'),
  ('https://cases.complianceworxs.com/batch-release-authorization/complete-file', 'CF02 complete-file bundle CTA',        'plink_1TDpuBBcdOgm3yGBZ4FBke9W', '14AcN4coH607fWdabb2cg0N', '$875', 87500, 'The Compliance Executive Inspection Defense Series', 'all-10 bundle'),
  ('https://cases.complianceworxs.com/oos-investigation-closure/complete-file',   'CF03 complete-file bundle CTA',        'plink_1TDpuBBcdOgm3yGBZ4FBke9W', '14AcN4coH607fWdabb2cg0N', '$875', 87500, 'The Compliance Executive Inspection Defense Series', 'all-10 bundle'),
  ('https://cases.complianceworxs.com/deviation-risk-assessment/complete-file',   'CF04 complete-file bundle CTA',        'plink_1TDpuBBcdOgm3yGBZ4FBke9W', '14AcN4coH607fWdabb2cg0N', '$875', 87500, 'The Compliance Executive Inspection Defense Series', 'all-10 bundle'),
  ('https://cases.complianceworxs.com/change-control-risk/complete-file',         'CF05 complete-file bundle CTA',        'plink_1TDpuBBcdOgm3yGBZ4FBke9W', '14AcN4coH607fWdabb2cg0N', '$875', 87500, 'The Compliance Executive Inspection Defense Series', 'all-10 bundle'),
  ('https://cases.complianceworxs.com/capa-effectiveness/complete-file',          'CF06 complete-file bundle CTA',        'plink_1TDpuBBcdOgm3yGBZ4FBke9W', '14AcN4coH607fWdabb2cg0N', '$875', 87500, 'The Compliance Executive Inspection Defense Series', 'all-10 bundle'),
  ('https://cases.complianceworxs.com/data-integrity/complete-file',              'CF07 complete-file bundle CTA',        'plink_1TDpuBBcdOgm3yGBZ4FBke9W', '14AcN4coH607fWdabb2cg0N', '$875', 87500, 'The Compliance Executive Inspection Defense Series', 'all-10 bundle'),
  ('https://cases.complianceworxs.com/supplier-qualification/complete-file',      'CF08 complete-file bundle CTA',        'plink_1TDpuBBcdOgm3yGBZ4FBke9W', '14AcN4coH607fWdabb2cg0N', '$875', 87500, 'The Compliance Executive Inspection Defense Series', 'all-10 bundle'),
  ('https://cases.complianceworxs.com/stability-oot/complete-file',               'CF09 complete-file bundle CTA',        'plink_1TDpuBBcdOgm3yGBZ4FBke9W', '14AcN4coH607fWdabb2cg0N', '$875', 87500, 'The Compliance Executive Inspection Defense Series', 'all-10 bundle'),
  ('https://cases.complianceworxs.com/complaint-investigation/complete-file',     'CF10 complete-file bundle CTA',        'plink_1TDpuBBcdOgm3yGBZ4FBke9W', '14AcN4coH607fWdabb2cg0N', '$875', 87500, 'The Compliance Executive Inspection Defense Series', 'all-10 bundle'),
  ('https://complianceworxs.com',                                                 'Homepage SEE THE STANDARD section',    'plink_1TDpuBBcdOgm3yGBZ4FBke9W', '14AcN4coH607fWdabb2cg0N', '$875', 87500, 'The Compliance Executive Inspection Defense Series', 'all-10 bundle')
ON CONFLICT (page_url, stripe_payment_link_id) DO UPDATE
  SET expected_display_price = EXCLUDED.expected_display_price,
      expected_amount_cents = EXCLUDED.expected_amount_cents,
      product_name = EXCLUDED.product_name,
      stripe_link_url_fragment = EXCLUDED.stripe_link_url_fragment,
      updated_at = now();