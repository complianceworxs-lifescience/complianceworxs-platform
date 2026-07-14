-- Track which replies have generated Attio hot-lead tasks (idempotency)
ALTER TABLE inbound_replies
  ADD COLUMN IF NOT EXISTS hot_lead_task_id TEXT,
  ADD COLUMN IF NOT EXISTS hot_lead_task_created_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_inbound_replies_hot_pending
  ON inbound_replies(reply_sentiment, hot_lead_task_id)
  WHERE reply_sentiment IN ('asset_requested', 'positive_intent') 
    AND hot_lead_task_id IS NULL;

COMMENT ON COLUMN inbound_replies.hot_lead_task_id IS 
  'Attio task ID created for hot-lead reply. Set by hot-lead-task-creator function.';