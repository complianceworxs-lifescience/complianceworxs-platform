-- Commitment log: what Jon committed to and whether it closed
CREATE TABLE IF NOT EXISTS operator_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  week_of DATE NOT NULL,
  commitment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'killed', 'rolled_forward')),
  closed_at TIMESTAMPTZ,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_operator_commitments_week
  ON operator_commitments(week_of DESC, status);

-- Strategic question queue: one per week, answered over time
CREATE TABLE IF NOT EXISTS operator_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  week_of DATE NOT NULL,
  question TEXT NOT NULL,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'answered', 'deferred', 'replaced')),
  answer TEXT,
  answered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_operator_questions_status
  ON operator_questions(status, week_of DESC);

-- Review archive: the weekly memo itself, for the record
CREATE TABLE IF NOT EXISTS operator_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  week_of DATE NOT NULL UNIQUE,
  
  -- Scoreboard snapshot
  revenue_mtd_cents INT,
  revenue_target_cents INT,
  days_remaining_in_month INT,
  qualified_conversations INT,
  pipeline_value_cents INT,
  
  -- The memo content
  scoreboard TEXT,
  what_moved TEXT,
  what_didnt_move TEXT,
  funnel_diagnosis TEXT,
  revenue_delta TEXT,
  commitment_log TEXT,
  strategic_question TEXT,
  
  attio_note_id TEXT,
  raw_metrics JSONB
);

CREATE INDEX IF NOT EXISTS idx_operator_reviews_week
  ON operator_reviews(week_of DESC);