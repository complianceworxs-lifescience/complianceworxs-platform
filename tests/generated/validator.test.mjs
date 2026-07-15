// GENERATED FILE -- do not edit by hand.
// Source of truth: contract.yaml. Regenerate with: node compiler/generate-tests.js
// M7-07: exercises the generated validateFieldItems against the generated fixtures.
// Run: node --experimental-strip-types --test tests/generated/*.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateFieldItems } from '../../compiler/generated/contract-generated.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '..', 'fixtures', 'generated');
const load = (f) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));

const ARRAY_FIELDS = [
  "evidenceReviewed_list",
  "gapFlags_list",
  "criticalGapsRanked_list",
  "claimStatus_list",
  "evidenceMatrix_list",
  "evidenceTraceability_list",
  "unsupportedClaims_list",
  "inspectorChallenge_list",
  "remediationScaffold_list",
  "executiveBriefBreakdown_list"
];

for (const field of ARRAY_FIELDS) {
  test(`validator: ${field} accepts its valid fixture`, () => {
    assert.doesNotThrow(() => validateFieldItems(field, load(`${field}.valid.json`), `test:${field}`));
  });
  test(`validator: ${field} rejects its invalid fixture`, () => {
    assert.throws(() => validateFieldItems(field, load(`${field}.invalid.json`), `test:${field}`));
  });
}
