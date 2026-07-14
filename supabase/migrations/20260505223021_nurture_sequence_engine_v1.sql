
-- =============================================================================
-- Nurture Sequence Engine v1 (May 5 2026)
-- Triggers: manual DM reply flag, email reply (positive/neutral/wrong_person),
--   tracked link clicks on case file pages.
-- Cadence: Touch 2 day 3, Touch 3 day 10, Touch 4 day 21.
-- Cohort-bound: each lead's target_account_priority OR case_file_interest selects
--   the sequence. One canonical sequence per cohort. Universal fallback.
-- =============================================================================

-- 1. Sequence content store. Add Jon edits content here, not in code.
CREATE TABLE IF NOT EXISTS nurture_sequences (
  id              bigserial PRIMARY KEY,
  cohort          text        NOT NULL,           -- e.g. 'batch_release_cohort', 'capa_effectiveness_cohort', 'universal'
  touch_number    integer     NOT NULL CHECK (touch_number BETWEEN 2 AND 4),
  day_offset      integer     NOT NULL,           -- days after enrollment when this touch fires
  subject         text        NOT NULL,
  body            text        NOT NULL,
  active          boolean     NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cohort, touch_number)
);

CREATE INDEX IF NOT EXISTS idx_nurture_sequences_cohort
  ON nurture_sequences (cohort, touch_number) WHERE active = true;

-- 2. Per-lead enrollment tracker.
CREATE TABLE IF NOT EXISTS nurture_enrollments (
  id                  bigserial PRIMARY KEY,
  staging_id          bigint      NOT NULL REFERENCES warm_outbound_staging(id) ON DELETE CASCADE,
  cohort              text        NOT NULL,
  trigger_source      text        NOT NULL,       -- 'manual_dm_reply' | 'email_reply' | 'link_click'
  trigger_detail      text,                       -- e.g. specific page URL clicked, reply classification
  enrolled_at         timestamptz NOT NULL DEFAULT now(),
  current_touch       integer     NOT NULL DEFAULT 1,    -- touch 1 was the first-touch email; we send 2,3,4
  next_touch_number   integer     NOT NULL DEFAULT 2,
  next_touch_due_at   timestamptz NOT NULL,
  last_touch_sent_at  timestamptz,
  last_touch_message_id text,
  status              text        NOT NULL DEFAULT 'active',  -- 'active' | 'completed' | 'paused' | 'cancelled_replied' | 'cancelled_purchased'
  cancelled_reason    text,
  cancelled_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- One active enrollment per staging_id at a time
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_enrollment_per_staging
  ON nurture_enrollments (staging_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_nurture_enrollments_due
  ON nurture_enrollments (next_touch_due_at) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_nurture_enrollments_status
  ON nurture_enrollments (status, cohort);

-- 3. Track-back fields on staging row (also makes Attio reporting easy)
ALTER TABLE warm_outbound_staging
  ADD COLUMN IF NOT EXISTS nurture_trigger        text,
  ADD COLUMN IF NOT EXISTS nurture_enrolled_at    timestamptz,
  ADD COLUMN IF NOT EXISTS nurture_next_due_at    timestamptz,
  ADD COLUMN IF NOT EXISTS nurture_status         text DEFAULT 'not_enrolled';

CREATE INDEX IF NOT EXISTS idx_staging_nurture_status
  ON warm_outbound_staging (nurture_status, nurture_next_due_at)
  WHERE nurture_status = 'active';

-- 4. Auto-update updated_at
CREATE OR REPLACE FUNCTION touch_nurture_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_nurture_sequences_updated_at ON nurture_sequences;
CREATE TRIGGER trg_nurture_sequences_updated_at
  BEFORE UPDATE ON nurture_sequences
  FOR EACH ROW EXECUTE FUNCTION touch_nurture_updated_at();

DROP TRIGGER IF EXISTS trg_nurture_enrollments_updated_at ON nurture_enrollments;
CREATE TRIGGER trg_nurture_enrollments_updated_at
  BEFORE UPDATE ON nurture_enrollments
  FOR EACH ROW EXECUTE FUNCTION touch_nurture_updated_at();
