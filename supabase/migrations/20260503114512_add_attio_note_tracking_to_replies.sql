ALTER TABLE inbound_replies
  ADD COLUMN IF NOT EXISTS attio_note_id TEXT,
  ADD COLUMN IF NOT EXISTS attio_note_pushed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_replies_undrafted_to_attio
  ON inbound_replies (drafted_at)
  WHERE draft_body IS NOT NULL AND attio_note_id IS NULL;