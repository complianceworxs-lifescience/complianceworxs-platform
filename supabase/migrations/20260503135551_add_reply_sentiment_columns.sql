ALTER TABLE inbound_replies 
  ADD COLUMN IF NOT EXISTS reply_sentiment TEXT,
  ADD COLUMN IF NOT EXISTS asset_requested BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_inbound_replies_sentiment 
  ON inbound_replies(reply_sentiment) WHERE reply_sentiment IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbound_replies_asset 
  ON inbound_replies(asset_requested) WHERE asset_requested = TRUE;