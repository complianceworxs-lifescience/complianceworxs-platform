-- 1. Add commission_rate to partners (default 25%)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS commission_rate numeric DEFAULT 0.25;

-- 2. Create partner_commissions table the existing checkout code writes to
CREATE TABLE IF NOT EXISTS partner_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid REFERENCES partners(id),
  partner_code text NOT NULL,
  order_id uuid REFERENCES orders(id),
  contact_id uuid,
  stripe_payment_intent_id text,
  amount_cents integer NOT NULL,
  commission_cents integer NOT NULL,
  commission_rate numeric DEFAULT 0.25,
  payout_status text DEFAULT 'pending',
  paid_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pc_partner_id ON partner_commissions(partner_id);
CREATE INDEX IF NOT EXISTS idx_pc_partner_code ON partner_commissions(partner_code);
CREATE INDEX IF NOT EXISTS idx_pc_order_id ON partner_commissions(order_id);
CREATE INDEX IF NOT EXISTS idx_pc_payout_status ON partner_commissions(payout_status);

-- 3. Drop the duplicate partner_attributions table I created earlier
DROP TABLE IF EXISTS partner_attributions;

-- 4. Update Tom's partner record so commission_rate is explicit
UPDATE partners SET commission_rate = 0.25 WHERE partner_code = 'valdata';