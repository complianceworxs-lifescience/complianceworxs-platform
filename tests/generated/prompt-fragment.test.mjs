// GENERATED FILE -- do not edit by hand.
// Source of truth: contract.yaml. Regenerate with: node compiler/generate-tests.js
// M7-08: pins each model field's PROMPT_CONSTRAINTS entry to the contract-derived expectation.
// Run: node --experimental-strip-types --test tests/generated/*.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPT_CONSTRAINTS } from '../../compiler/generated/contract-generated.ts';

const EXPECTED = {
  "investigatorQuestion": "investigatorQuestion is a single prose string. Do not output an array, list, bullets, or numbered items.",
  "authorizationSummary": "authorizationSummary is a single prose string. Do not output an array, list, bullets, or numbered items.",
  "authorizationRationale": "authorizationRationale is a single prose string. Do not output an array, list, bullets, or numbered items.",
  "knownLimitations": "knownLimitations is a single prose string. Do not output an array, list, bullets, or numbered items.",
  "defensibilityRating": "defensibilityRating must be exactly one of: \"Critical Exposure\", \"At Risk\", \"Defensible with Gaps\", \"Inspection-Ready\".",
  "evidenceReviewed_list": "evidenceReviewed_list is a JSON array whose items are JSON objects -- never bare strings.",
  "riskEvaluation": "riskEvaluation is a single prose string. Do not output an array, list, bullets, or numbered items.",
  "alternativesConsidered": "alternativesConsidered is a single prose string. Do not output an array, list, bullets, or numbered items.",
  "regulatoryAlignment": "regulatoryAlignment is a single prose string. Do not output an array, list, bullets, or numbered items.",
  "residualExposureStatement": "residualExposureStatement is a single prose string. Do not output an array, list, bullets, or numbered items.",
  "gapFlags_list": "gapFlags_list is a JSON array whose items are JSON objects -- never bare strings.",
  "criticalGapsRanked_list": "criticalGapsRanked_list is a JSON array whose items are plain strings.",
  "claimStatus_list": "Each claimStatus_list entry MUST be a JSON object of the exact shape {\"claim\": <string>, \"status\": <\"Claimed in rationale\" | \"Supported by attached evidence\" | \"Not traceable in record\">} -- never a bare string, never a nested array, never additional keys.",
  "evidenceMatrix_list": "evidenceMatrix_list is a JSON array whose items are JSON objects -- never bare strings.",
  "evidenceTraceability_list": "Each evidenceTraceability_list entry MUST be a JSON object of the exact shape {\"claimId\": <string>} -- never a bare string, never a nested array, never additional keys.",
  "unsupportedClaims_list": "unsupportedClaims_list is a JSON array whose items are JSON objects -- never bare strings.",
  "inspectorChallenge_list": "inspectorChallenge_list is a JSON array whose items are JSON objects -- never bare strings.",
  "remediationScaffold_list": "remediationScaffold_list is a JSON array whose items are JSON objects -- never bare strings.",
  "executiveBrief": "executiveBrief is a single prose string. Do not output an array, list, bullets, or numbered items."
};

const NO_FRAGMENT = [
  "executiveBriefBreakdown_list"
];

for (const [field, want] of Object.entries(EXPECTED)) {
  test(`prompt-fragment: ${field} matches contract`, () => {
    assert.equal(PROMPT_CONSTRAINTS[field], want);
  });
}
for (const field of NO_FRAGMENT) {
  test(`prompt-fragment: ${field} (derived) has no fragment`, () => {
    assert.ok(!(field in PROMPT_CONSTRAINTS), `${field} should have no prompt fragment`);
  });
}
