# IRR Contract (generated from contract.yaml)

| Field | Stage | Source | Type | Notes |
|---|---|---|---|---|
| `investigatorQuestion` | 5 | model | string | The specific question an inspector would ask about this decision. |
| `authorizationSummary` | 5 | model | string | Summary of who authorized the decision and on what basis. |
| `authorizationRationale` | 5 | model | string | The reasoning that justified the decision. |
| `knownLimitations` | 5 | model | string | Every distinct deficiency, explained in full exactly once. |
| `defensibilityRating` | 5 | model | enum | Overall defensibility rating for the decision. |
| `evidenceReviewed_list` | 4 | model | array<object> | Evidence items reviewed in support of the decision. |
| `riskEvaluation` | 4 | model | string | How regulatory risk was evaluated for this decision. |
| `alternativesConsidered` | 4 | model | string | Alternative interpretations or courses of action considered. |
| `regulatoryAlignment` | 4 | model | string | How the decision aligns with applicable regulatory expectations. |
| `residualExposureStatement` | 4 | model | string | What inspection exposure remains after this decision. |
| `gapFlags_list` | 6 | model | array<object> | Documentation gaps, each paired with an imperative next action. |
| `criticalGapsRanked_list` | 6 | model | array<string> | The 2-3 most inspection-critical gaps, ranked by severity, named specifically. INFERRED shape (string names) -- not previously validated at runtime; confirm against actual stage-6 output before relying on the item-shape check in production. |
| `claimStatus_list` | 7 | model | array<object> | Classification of every factual claim in the rationale. |
| `evidenceMatrix_list` | 8 | model | array<object> | Matrix mapping claims to the specific evidence that supports them. |
| `evidenceTraceability_list` | 8 | model | array<object> | One entry per claim, tracing it to evidence or marking it unsupported. |
| `unsupportedClaims_list` | 9 | model | array<object> | What the record fails to establish, for each unsupported claim. |
| `inspectorChallenge_list` | 10 | model | array<object> | Inspector-facing challenge/response pairs, one per gap. |
| `remediationScaffold_list` | 11 | model | array<object> | Bracketed-blank documentation scaffolds, one per gap. |
| `executiveBriefBreakdown_list` | 12 | derived | array<object> | Deterministically assembled from criticalGapsRanked_list + defensibilityRating. Not model-generated -- no prompt fragment is produced for this field. |
| `executiveBrief` | 13 | model | string | 2-3 sentence summary of the completed IRR analysis for a QA leader. |
