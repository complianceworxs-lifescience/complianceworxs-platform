ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS first_touch_draft_subject TEXT,
  ADD COLUMN IF NOT EXISTS first_touch_draft_body TEXT,
  ADD COLUMN IF NOT EXISTS first_touch_drafted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_touch_attio_note_id TEXT;

CREATE INDEX IF NOT EXISTS idx_staging_high_priority_undrafted
  ON warm_outbound_staging (fit_score DESC)
  WHERE enrichment_status = 'enriched' 
    AND dispatched_at IS NULL 
    AND fit_score >= 70 
    AND first_touch_draft_body IS NULL;