ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS is_paying_customer BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN warm_outbound_staging.is_paying_customer IS
  'TRUE = exclude from ALL outbound flows (drafter, dispatcher, ghost hunter, dispatcher). Set when a Stripe payment lands or manually for known customers.';

-- Mark Carissa
UPDATE warm_outbound_staging SET is_paying_customer = TRUE WHERE id = 107;