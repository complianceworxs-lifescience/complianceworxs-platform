CREATE TABLE IF NOT EXISTS inbound_replies (
  id BIGSERIAL PRIMARY KEY,
  -- Source
  gmail_message_id TEXT UNIQUE,
  gmail_thread_id TEXT,
  from_email TEXT NOT NULL,
  from_name TEXT,
  subject TEXT,
  body_plain TEXT,           -- raw reply text, capped at 8KB at insert time
  received_at TIMESTAMPTZ DEFAULT NOW(),

  -- Linkage
  staging_id BIGINT REFERENCES warm_outbound_staging(id) ON DELETE SET NULL,
  attio_record_id TEXT,
  buyer_pipeline_entry_id TEXT,

  -- Classification
  classification TEXT,                      -- positive | negative | neutral | wrong_person | ooo | unsubscribe | spam_or_unrelated
  classification_reason TEXT,               -- short claude-generated explanation
  classification_confidence NUMERIC(3,2),   -- 0.00 - 1.00
  classified_at TIMESTAMPTZ,
  classified_by TEXT,                       -- 'claude_haiku' | 'manual' | 'rules'

  -- Response drafting
  draft_subject TEXT,
  draft_body TEXT,
  draft_status TEXT DEFAULT 'pending',      -- pending | drafted | sent | skipped
  drafted_at TIMESTAMPTZ,

  -- Stage transition recommendation
  recommended_stage TEXT,                   -- Engaged | High intent | Cold | Abandoned | Purchased
  applied_stage_at TIMESTAMPTZ,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbound_replies_unclassified
  ON inbound_replies (received_at) WHERE classification IS NULL;
CREATE INDEX IF NOT EXISTS idx_inbound_replies_undrafted
  ON inbound_replies (received_at) WHERE classification IN ('positive', 'neutral') AND draft_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_inbound_replies_email ON inbound_replies (LOWER(from_email));
CREATE INDEX IF NOT EXISTS idx_inbound_replies_thread ON inbound_replies (gmail_thread_id);
CREATE INDEX IF NOT EXISTS idx_inbound_replies_classification ON inbound_replies (classification, received_at DESC);

-- Realtime so the dashboard / inbox UI can react
ALTER PUBLICATION supabase_realtime ADD TABLE inbound_replies;