-- ================================================================
-- DM TEMPLATE + CLASSIFIER SYSTEM
-- Classification buckets map directly to primary_authorization_domain
-- AI classifies → system injects lead data into vetted template
-- No freeform generation for connection messages
-- ================================================================

CREATE TABLE IF NOT EXISTS dm_templates (
  id              SERIAL PRIMARY KEY,
  template_key    TEXT NOT NULL UNIQUE,
  authorization_domain TEXT NOT NULL,  -- batch_release | change_control | deviation | capa | oos_oot | supplier_qualification | generic
  role_target     TEXT,                -- qa | validation | regulatory | manufacturing | null=any
  variant_key     TEXT,                -- maps to outbound_ab_variants
  connection_note TEXT NOT NULL,       -- LinkedIn connection request (≤300 chars)
  dm_body         TEXT NOT NULL,       -- First DM after acceptance (≤280 chars per CW standard)
  performance_score NUMERIC DEFAULT 0, -- updated by ML analyzer
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- VETTED TEMPLATES — human-written, inspector-framed, CW voice
-- Connection note: authorization logic frame, no CTA, <300 chars
-- DM body: specific indefensible moment, no pitch, <280 chars

INSERT INTO dm_templates (template_key, authorization_domain, role_target, variant_key, connection_note, dm_body) VALUES

-- BATCH RELEASE (largest segment: QA + manufacturing)
(
  'batch_release_qa_v1',
  'batch_release', 'qa', 'opener_inspector_question_v1',
  'When an FDA inspector asks who authorized a batch disposition with a closed OOS and why — can your team reconstruct that decision trail today? Connecting around that gap.',
  '{first_name} — when the inspector asks who signed off on that batch and what evidence they reviewed, the batch record shows the signature. The authorization logic behind it usually doesn''t exist as a formal record.'
),
(
  'batch_release_manufacturing_v1',
  'batch_release', 'manufacturing', 'opener_exposure_moment_v1',
  'Six weeks before a PAI, the batch release authorization trail is the one QA teams wish they''d documented differently. Connecting with manufacturing leaders around that gap.',
  '{first_name} — the batch record is complete. The disposition rationale, the risk evaluation, who made the call and why — that''s what the inspector asks for that the batch record doesn''t contain.'
),

-- CHANGE CONTROL (validation + regulatory)
(
  'change_control_validation_v1',
  'change_control', 'validation', 'opener_inspector_question_v1',
  'When an FDA inspector asks who authorized a CSV change and what risk assessment justified it — the validation protocol shows what was tested. The decision behind why that change was approved usually isn''t a formal record.',
  '{first_name} — change control documentation shows the change was approved. The authorization logic — who evaluated the risk, what evidence they reviewed, why they signed — that''s what 483 observations are written about.'
),
(
  'change_control_regulatory_v1',
  'change_control', 'regulatory', 'opener_inspector_question_v1',
  'The regulatory filing shows the change was approved. What it rarely shows is who made the authorization decision, what risk evidence they reviewed, and why they concluded it was acceptable.',
  '{first_name} — when the inspector asks who authorized a significant change and what risk logic justified it, the answer isn''t in the change control form. It''s in a record most organizations don''t have.'
),

-- DEVIATION / CAPA
(
  'deviation_qa_v1',
  'deviation', 'qa', 'opener_inspector_question_v1',
  'When an FDA inspector asks who decided a deviation was minor and what evidence justified that classification — the deviation report shows the category. The authorization logic behind it usually doesn''t exist as a record.',
  '{first_name} — the deviation log shows it was classified as minor and closed. Who made that call, what evidence they reviewed, why they concluded the risk was acceptable — that''s what the inspector asks for next.'
),

-- OOS / OOT
(
  'oos_qa_v1',
  'oos_oot', 'qa', 'opener_inspector_question_v1',
  'When an FDA inspector asks who authorized the OOS investigation conclusion and what logic justified the disposition — the lab report shows the result. The decision behind why it was acceptable rarely exists as a formal record.',
  '{first_name} — the OOS investigation shows the work. Who authorized the final disposition, what risk logic they applied, why they concluded the batch was releasable — that''s a separate record most QA teams don''t have.'
),

-- SUPPLIER QUALIFICATION
(
  'supplier_qual_qa_v1',
  'supplier_qualification', 'qa', 'opener_inspector_question_v1',
  'When an FDA inspector asks who authorized a critical supplier and what risk evaluation justified qualification — the approved supplier list shows the name. The authorization logic behind the decision usually isn''t a formal record.',
  '{first_name} — the supplier audit report shows what was assessed. Who made the qualification decision, what risk evidence they evaluated, why they concluded the supplier was acceptable — that''s the record that''s missing in most 483 observations.'
),

-- GENERIC FALLBACK (no primary_authorization_domain or thin profile)
(
  'generic_qa_v1',
  'generic', 'qa', 'opener_inspector_question_v1',
  'When an FDA inspector asks who authorized a critical compliance decision and what evidence justified it — most QA teams can show the documentation. The authorization logic behind the decision is a different record entirely.',
  '{first_name} — compliance documentation shows what was done. The record behind who authorized the decision, what evidence they reviewed, and why they concluded it was acceptable — that''s what inspectors ask for that most organizations can''t produce.'
),
(
  'generic_any_v1',
  'generic', NULL, 'opener_inspector_question_v1',
  'FDA inspectors don''t just review documentation — they ask who made the decision, based on what evidence, and why it was justified. Most life sciences teams can answer the first question. The other two require a different kind of record.',
  '{first_name} — the documentation shows the decision was made. The authorization logic behind it — who evaluated the risk, what evidence they reviewed, why they concluded it was acceptable — that''s what 483 observations are written about.'
)

ON CONFLICT (template_key) DO NOTHING;

-- RLS
ALTER TABLE dm_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON dm_templates FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Add template tracking to warm_outbound_staging
ALTER TABLE warm_outbound_staging 
  ADD COLUMN IF NOT EXISTS dm_template_key TEXT,
  ADD COLUMN IF NOT EXISTS dm_classification_domain TEXT,
  ADD COLUMN IF NOT EXISTS dm_classified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dm_model_used TEXT;  -- 'classifier' | 'haiku' | 'sonnet' | 'template_only'

COMMENT ON TABLE dm_templates IS 'Vetted human-written DM templates. AI classifies lead into domain bucket, system injects data. No freeform generation.';