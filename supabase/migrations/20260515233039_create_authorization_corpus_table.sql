-- Authorization corpus: the accumulated authorization behavior across all IRRs
-- This is the long-term moat — every IRR generated writes one row here

CREATE TABLE IF NOT EXISTS authorization_corpus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lineage
  authorization_session_id UUID REFERENCES authorization_sessions(id),
  irr_id UUID,  -- unbound FK for now — wire to IRR delivery table when it stabilizes
  staging_id BIGINT REFERENCES warm_outbound_staging(id),
  attio_record_id TEXT,

  -- Domain + investigator pressure + inspection stage (high-value tags)
  authorization_domain TEXT NOT NULL CHECK (authorization_domain IN (
    'batch_release', 'capa', 'oos_oot', 'deviation',
    'change_control', 'data_integrity', 'complaint',
    'visual_inspection', 'bud', 'supplier_qualification',
    'validation_exception'
  )),
  investigator_pressure_type TEXT CHECK (investigator_pressure_type IN (
    'recurrence',
    'contamination',
    'release_justification',
    'data_integrity',
    'sterility',
    'root_cause',
    'effectiveness',
    'patient_risk',
    'other'
  )),
  inspection_stage TEXT CHECK (inspection_stage IN (
    'routine_inspection',
    'for_cause',
    'pre_approval',
    'warning_letter_response',
    'internal_audit',
    'mock_inspection',
    'remediation',
    'other'
  )),

  -- The 10 canonical elements (JSONB for pattern extraction later)
  authorization_event       JSONB,
  investigator_question     JSONB,
  authorization_rationale   JSONB,
  evidence_reviewed         JSONB,
  evidence_excluded         JSONB,
  alternative_hypotheses    JSONB,
  residual_uncertainty      JSONB,
  boundary_conditions       JSONB,
  retrieval_lineage         JSONB,
  approval_chain            JSONB,

  -- Future-proofing for pattern extraction (schema ready, behavior deferred)
  rationale_embedding       vector(1536),
  pattern_tags              TEXT[],
  reasoning_classification  TEXT,

  -- Metadata
  domain_schema_version     TEXT DEFAULT 'v1.0',
  framework_version         TEXT DEFAULT 'v1.0',
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corpus_domain
ON authorization_corpus(authorization_domain);

CREATE INDEX IF NOT EXISTS idx_corpus_pressure
ON authorization_corpus(investigator_pressure_type);

CREATE INDEX IF NOT EXISTS idx_corpus_inspection_stage
ON authorization_corpus(inspection_stage);

CREATE INDEX IF NOT EXISTS idx_corpus_session
ON authorization_corpus(authorization_session_id);

CREATE INDEX IF NOT EXISTS idx_corpus_staging
ON authorization_corpus(staging_id);

CREATE INDEX IF NOT EXISTS idx_corpus_pattern_tags
ON authorization_corpus USING GIN(pattern_tags);

COMMENT ON TABLE authorization_corpus IS
'The accumulated authorization behavior corpus. One row per IRR. Captures the 10 canonical framework elements as JSONB plus high-value tags (domain, investigator pressure, inspection stage). Long-term moat: pattern extraction across customers and inspections over time. Schema is future-ready for embedding-based retrieval (rationale_embedding column) but no embedding workflow is built yet — capture data now, build intelligence later.';