CREATE TABLE IF NOT EXISTS partner_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_code text NOT NULL,
  partner_id uuid REFERENCES partners(id),
  email text NOT NULL,
  product text,
  amount_cents integer,
  commission_cents integer,
  commission_rate numeric DEFAULT 0.25,
  source_event text DEFAULT 'page_visit',
  stripe_session_id text,
  status text DEFAULT 'pending',
  attributed_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_part_attr_code ON partner_attributions(partner_code);
CREATE INDEX IF NOT EXISTS idx_part_attr_email ON partner_attributions(email);
CREATE INDEX IF NOT EXISTS idx_part_attr_status ON partner_attributions(status);
CREATE INDEX IF NOT EXISTS idx_part_attr_attributed ON partner_attributions(attributed_at DESC);