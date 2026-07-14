
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS checkout_abandoned boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS stripe_session_id text;

CREATE INDEX IF NOT EXISTS leads_checkout_abandoned_idx ON leads(checkout_abandoned) WHERE checkout_abandoned = true;
CREATE INDEX IF NOT EXISTS leads_stripe_session_id_idx ON leads(stripe_session_id);
