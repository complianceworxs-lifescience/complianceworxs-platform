CREATE TABLE IF NOT EXISTS content_pipeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  source_tier TEXT NOT NULL CHECK (source_tier IN ('fda', 'trade_press', 'linkedin_group')),
  source_url TEXT NOT NULL,
  source_headline TEXT NOT NULL,
  source_date DATE,
  source_excerpt TEXT,
  source_publisher TEXT,

  relevance_score INT NOT NULL DEFAULT 0,
  relevance_signals TEXT[],

  cw_angle TEXT,
  inspector_question TEXT,
  documentation_gap TEXT,
  target_cohort TEXT CHECK (target_cohort IN ('fresh_483', 'active', 'resolved', 'inherited', 'general')),

  hook_draft TEXT,
  post_draft TEXT,

  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'angled', 'approved', 'drafted', 'posted', 'killed')),

  posted_at TIMESTAMPTZ,
  notes TEXT,

  UNIQUE(source_url)
);

CREATE INDEX IF NOT EXISTS idx_content_pipeline_status_score
  ON content_pipeline(status, relevance_score DESC);

CREATE INDEX IF NOT EXISTS idx_content_pipeline_created
  ON content_pipeline(created_at DESC);

CREATE OR REPLACE FUNCTION touch_content_pipeline()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS content_pipeline_touch ON content_pipeline;
CREATE TRIGGER content_pipeline_touch
  BEFORE UPDATE ON content_pipeline
  FOR EACH ROW EXECUTE FUNCTION touch_content_pipeline();