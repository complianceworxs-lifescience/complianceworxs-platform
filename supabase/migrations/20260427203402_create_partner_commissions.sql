
CREATE TABLE IF NOT EXISTS partner_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  partner_code TEXT NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  stripe_payment_intent_id TEXT,
  amount_cents INT NOT NULL,
  commission_cents INT NOT NULL,
  commission_rate NUMERIC(4,3) NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payout_status TEXT NOT NULL DEFAULT 'pending' CHECK (payout_status IN ('pending', 'approved', 'paid', 'reversed', 'voided')),
  payout_at TIMESTAMPTZ,
  payout_reference TEXT,
  notes TEXT
);

CREATE INDEX idx_partner_commissions_partner ON partner_commissions(partner_id, earned_at DESC);
CREATE INDEX idx_partner_commissions_order ON partner_commissions(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_partner_commissions_payout ON partner_commissions(payout_status);

ALTER TABLE orders 
  ADD COLUMN IF NOT EXISTS partner_code TEXT,
  ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_partner_code ON orders(partner_code) WHERE partner_code IS NOT NULL;
