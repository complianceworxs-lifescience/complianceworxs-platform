// Stage registry for M7-03 stage certification.
// Names + order are ground truth from production irr_stage_runs (DR §5.1). Stage->field
// mapping is NOT hard-coded here; it is derived from the contract (FIELD_SPECS[f].stage)
// in certify-core.mjs. Reconciliation keys come from CW-EXEC-001 §12 (exact coverage).
export const STAGES = {
  validate_contract:       { n: 1,  kind: 'deterministic' },
  compile_execution_spec:  { n: 2,  kind: 'deterministic' },
  compile_prompt_spec:     { n: 3,  kind: 'deterministic' },
  evidence_risk_reasoning: { n: 4,  kind: 'model' },
  authorization_reasoning: { n: 5,  kind: 'model' },
  gap_analysis:            { n: 6,  kind: 'model' },
  claim_status:            { n: 7,  kind: 'model', reconcile: { field: 'claimStatus_list', key: 'claim' } },
  evidence_traceability:   { n: 8,  kind: 'model', reconcile: { field: 'evidenceTraceability_list', key: 'claimId' } },
  unsupported_claims:      { n: 9,  kind: 'model' },
  inspector_challenge:     { n: 10, kind: 'model' },
  remediation_scaffold:    { n: 11, kind: 'model' },
  deterministic_assembly:  { n: 12, kind: 'deterministic' }, // has a derived output field (validated)
  executive_brief:         { n: 13, kind: 'model' },
  schema_validation:       { n: 14, kind: 'deterministic' },
  final_assembly:          { n: 15, kind: 'deterministic' },
};

// The 9 model-reasoning stages require >=5 canonical cases (DR §5.1 / N-04).
export const MIN_MODEL_CASES = 5;
