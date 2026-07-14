-- ============================================================================
-- irr_challenge_layer — V2 FDA challenge analysis overlay
-- 
-- Lives 1:1 with irr_sessions. Preserves the investigator-anticipation layer
-- that V1 lacks. V1 stays untouched. V3+ layers can chain via separate tables.
--
-- Structure mirrors the canonical 10-element framework but adds the defensive
-- overlay: for each element where investigators apply pressure, what is the
-- anticipated challenge, what is the prepared response, what bound is named.
-- ============================================================================

CREATE TABLE IF NOT EXISTS irr_challenge_layer (
  -- ========================================================================
  -- IDENTITY & LINEAGE
  -- ========================================================================
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  irr_session_id UUID NOT NULL UNIQUE REFERENCES irr_sessions(id) ON DELETE CASCADE,
  authorization_session_id UUID REFERENCES authorization_sessions(id),
  
  -- Versioning — allows future V3 rev of challenge layer per IRR
  challenge_layer_version TEXT NOT NULL DEFAULT 'v2.0',
  framework_version TEXT NOT NULL DEFAULT 'v1.0',
  
  -- ========================================================================
  -- INVESTIGATOR PRESSURE ARCHETYPES
  -- The challenge layer maps each anticipated investigator pressure type
  -- to the specific challenge angle, the prepared response, and the named bound
  -- ========================================================================
  
  -- Primary pressure archetype (matches authorization_corpus enum)
  primary_pressure_type TEXT NOT NULL CHECK (primary_pressure_type IN (
    'recurrence', 'contamination', 'release_justification',
    'data_integrity', 'sterility', 'root_cause',
    'effectiveness', 'patient_risk', 'other'
  )),
  
  -- Secondary pressure archetypes (array — multiple challenges anticipated)
  secondary_pressure_types TEXT[] DEFAULT '{}',
  
  -- Inspection stage this challenge layer defends against
  inspection_stage TEXT CHECK (inspection_stage IN (
    'routine_inspection', 'for_cause', 'pre_approval',
    'warning_letter_response', 'internal_audit', 'mock_inspection',
    'remediation', 'other'
  )),
  
  -- ========================================================================
  -- CHALLENGE-LAYER CORE: anticipated challenges per element
  -- 
  -- Each JSONB column maps to one of the 10 canonical framework elements.
  -- Schema for each entry:
  -- {
  --   "anticipated_challenge": "What the investigator would press on",
  --   "challenge_severity": "high|medium|low",
  --   "prepared_response": "How we defend without overclaiming",
  --   "evidence_referenced": ["DEV-HOU-2025-002", "AUDIT-2026-014"],
  --   "bound_named": "What we acknowledge is not certain",
  --   "escalation_path": "What triggers re-review if challenged"
  -- }
  -- ========================================================================
  
  -- Element 1: Authorization Event — challenges to WHO made the call & WHEN
  challenge_authorization_event JSONB,
  
  -- Element 2: Investigator Question — pre-stated framing of likely Q
  challenge_investigator_question JSONB,
  
  -- Element 3: Authorization Rationale — challenges to the REASONING itself
  challenge_authorization_rationale JSONB,
  
  -- Element 4: Evidence Reviewed — challenges to EVIDENCE SUFFICIENCY
  challenge_evidence_reviewed JSONB,
  
  -- Element 5: Evidence Excluded — challenges to WHAT WAS REJECTED & WHY
  challenge_evidence_excluded JSONB,
  
  -- Element 6: Alternative Hypotheses — challenges from competing explanations
  -- (most likely the highest-density section)
  challenge_alternative_hypotheses JSONB,
  
  -- Element 7: Residual Uncertainty — challenges to BOUNDED RISK acceptance
  challenge_residual_uncertainty JSONB,
  
  -- Element 8: Boundary Conditions — challenges to WHEN AUTHORIZATION FAILS
  challenge_boundary_conditions JSONB,
  
  -- Element 9: Retrieval Lineage — challenges to RECONSTRUCTABILITY
  challenge_retrieval_lineage JSONB,
  
  -- Element 10: Approval Chain — challenges to AUTHORITY & CONCURRENCE
  challenge_approval_chain JSONB,
  
  -- ========================================================================
  -- TOP CHALLENGE ANTICIPATIONS
  -- Distilled "top 3-5" challenges — what the IRR most expects to defend
  -- Array of objects: [{ challenge, severity, response_summary, element_ref }]
  -- ========================================================================
  top_challenges JSONB,
  
  -- ========================================================================
  -- DEFENSE POSTURE
  -- Overall summary of how the IRR defends — strongest argument, weakest seam
  -- ========================================================================
  strongest_defensive_position TEXT,
  weakest_defensive_position TEXT,
  pre_emptive_escalation_path TEXT,
  
  -- ========================================================================
  -- PATTERN EXTRACTION (future use, schema-ready)
  -- ========================================================================
  pattern_tags TEXT[] DEFAULT '{}',
  challenge_signature_embedding vector(1536),
  
  -- ========================================================================
  -- METADATA
  -- ========================================================================
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT DEFAULT 'system',
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_irr_challenge_layer_session
  ON irr_challenge_layer(irr_session_id);

CREATE INDEX IF NOT EXISTS idx_irr_challenge_layer_pressure
  ON irr_challenge_layer(primary_pressure_type);

CREATE INDEX IF NOT EXISTS idx_irr_challenge_layer_inspection_stage
  ON irr_challenge_layer(inspection_stage);

CREATE INDEX IF NOT EXISTS idx_irr_challenge_layer_pattern_tags
  ON irr_challenge_layer USING GIN(pattern_tags);

CREATE INDEX IF NOT EXISTS idx_irr_challenge_layer_authorization_session
  ON irr_challenge_layer(authorization_session_id);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_irr_challenge_layer_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_irr_challenge_layer_updated_at
  BEFORE UPDATE ON irr_challenge_layer
  FOR EACH ROW
  EXECUTE FUNCTION update_irr_challenge_layer_updated_at();

COMMENT ON TABLE irr_challenge_layer IS
'V2 FDA challenge analysis overlay for IRRs. 1:1 with irr_sessions. Preserves anticipated investigator challenges per canonical framework element, prepared responses without overclaiming, named bounds. V1 irr_sessions remains stable; this layer is additive. Future layers (V3+) can chain via separate linked tables without schema churn.';

COMMENT ON COLUMN irr_challenge_layer.challenge_authorization_event IS
'JSONB: anticipated challenges to WHO authorized & WHEN. Schema: {anticipated_challenge, challenge_severity, prepared_response, evidence_referenced, bound_named, escalation_path}';

COMMENT ON COLUMN irr_challenge_layer.top_challenges IS
'JSONB array of top 3-5 distilled challenges. Schema: [{challenge, severity, response_summary, element_ref}]. Used by renderer to surface the most likely investigator pressure points above-the-fold.';