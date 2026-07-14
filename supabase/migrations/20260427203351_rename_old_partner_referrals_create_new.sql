
-- Archive the old empty table (in case any portal code references it later, we keep it discoverable)
ALTER TABLE partner_referrals RENAME TO partner_referrals_legacy_introductions;

-- Now create the new partner_referrals (cookie-tracking attribution table)
CREATE TABLE partner_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  partner_code TEXT NOT NULL,
  referred_email TEXT,
  referred_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_landing_url TEXT,
  user_agent TEXT,
  ip_hash TEXT,
  attribution_window_ends_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
  converted_at TIMESTAMPTZ,
  first_purchase_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_partner_referrals_partner ON partner_referrals(partner_id);
CREATE INDEX idx_partner_referrals_email ON partner_referrals(LOWER(referred_email)) WHERE referred_email IS NOT NULL;
CREATE INDEX idx_partner_referrals_window ON partner_referrals(attribution_window_ends_at) WHERE converted_at IS NULL;
