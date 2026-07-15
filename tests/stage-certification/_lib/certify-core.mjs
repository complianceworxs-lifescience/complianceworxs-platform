// M7-03 stage-certification engine.
//
// Certifies a stage by running its AUTHORED canonical cases through the REAL contract
// logic — FIELD_SPECS + validateFieldItems from the committed compiler output — with NO
// model invocation. Each case carries a candidate stage `output` and an AUTHORED expected
// verdict (`expect.accepted`). The engine recomputes the verdict from the contract and
// asserts it matches what the author declared. A stage certifies iff every case matches.
//
// Design rules honoured here:
//   * Contract-first (CW-ARCH-001 §9.3): the stage->field map is derived from
//     FIELD_SPECS[f].stage, never hard-coded. Item shapes are checked by the generated
//     validateFieldItems, not a re-implementation.
//   * N-03: a "bare model response" (output that is not a structured object) is rejected.
//   * N-04: the expected verdict must be AUTHORED on each case; a case with no
//     expect.accepted is a certification failure, and a model stage with <5 cases fails.
//   * Reconciliation (CW-EXEC-001 §12) for claim_status / evidence_traceability: the
//     list's key values must EXACTLY cover the case's authored `reconcileAgainst` set
//     (no missing, no extra, no duplicate).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { FIELD_SPECS, validateFieldItems } from '../../../compiler/generated/contract-generated.ts';
import { STAGES, MIN_MODEL_CASES } from './stages.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)); // tests/stage-certification/_lib
const ROOT = resolve(HERE, '..');                     // tests/stage-certification

// Output fields a stage is responsible for, derived from the contract (single source of
// truth). Deterministic stages with no contract fields return [] (structural-only certify).
export function outputFieldsFor(n) {
  return Object.keys(FIELD_SPECS).filter((f) => FIELD_SPECS[f].stage === n);
}

// Recompute the contract verdict for one case's output. Returns { accepted, reason }.
function evaluate(name, stage, outFields, kase) {
  const out = kase.output;
  // N-03: certifying a bare/non-object model response must fail.
  if (out === null || typeof out !== 'object' || Array.isArray(out)) {
    return { accepted: false, reason: 'output is not a structured JSON object (bare model response)' };
  }
  for (const f of outFields) {
    const spec = FIELD_SPECS[f];
    const val = out[f];
    if (val === undefined) return { accepted: false, reason: `missing required field ${f}` };
    if (spec.type === 'array') {
      if (!Array.isArray(val)) return { accepted: false, reason: `${f} must be a JSON array` };
      try {
        validateFieldItems(f, val, `certify:${name}`); // the REAL generated validator
      } catch (e) {
        return { accepted: false, reason: (e && e.message) || `invalid items in ${f}` };
      }
    } else if (spec.type === 'string') {
      if (typeof val !== 'string') return { accepted: false, reason: `${f} must be a string` };
      if (spec.enum && !spec.enum.includes(val)) return { accepted: false, reason: `${f} "${val}" is not in the allowed enum` };
    }
  }
  // Reconciliation stages: key coverage must be exact.
  const rec = stage.reconcile;
  if (rec && Array.isArray(kase.reconcileAgainst)) {
    const list = Array.isArray(out[rec.field]) ? out[rec.field] : [];
    const seen = new Set();
    for (const it of list) {
      const k = it && it[rec.key];
      if (seen.has(k)) return { accepted: false, reason: `duplicate ${rec.key} "${k}" in ${rec.field} (reconciliation)` };
      seen.add(k);
    }
    const want = new Set(kase.reconcileAgainst);
    for (const k of want) if (!seen.has(k)) return { accepted: false, reason: `${rec.field} is missing ${rec.key} "${k}" (reconciliation)` };
    for (const k of seen) if (!want.has(k)) return { accepted: false, reason: `${rec.field} has extra ${rec.key} "${k}" (reconciliation)` };
  }
  return { accepted: true, reason: 'all contract checks passed' };
}

function casesDirFor(name) {
  // CW_CASES_DIR overrides the cases directory for a SINGLE stage — used by the CP-3
  // negative test to point at a deliberately-corrupted copy without touching the repo.
  if (process.env.CW_CASES_DIR) return resolve(process.env.CW_CASES_DIR);
  return join(ROOT, name, 'cases');
}

function loadCases(name) {
  const dir = casesDirFor(name);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const kase = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      kase._file = f;
      return kase;
    });
}

// Certify one stage. Returns a structured result; never throws for case-level problems.
export function certifyStage(name) {
  const stage = STAGES[name];
  if (!stage) throw new Error(`unknown stage: ${name}`);
  const outFields = outputFieldsFor(stage.n);
  const cases = loadCases(name);
  const errors = [];

  if (stage.kind === 'model' && cases.length < MIN_MODEL_CASES) {
    errors.push(`model stage "${name}" has ${cases.length} cases; requires >= ${MIN_MODEL_CASES} (M7-04 / N-04)`);
  }

  const results = [];
  for (const kase of cases) {
    if (!kase.expect || typeof kase.expect.accepted !== 'boolean') {
      errors.push(`${kase._file}: no authored expect.accepted (N-04: the expected verdict must be authored, not model-derived)`);
      results.push({ id: kase.id || kase._file, ok: false, reason: 'missing authored expect.accepted' });
      continue;
    }
    const verdict = evaluate(name, stage, outFields, kase);
    const ok = verdict.accepted === kase.expect.accepted;
    if (!ok) {
      errors.push(`${kase._file}: authored expect.accepted=${kase.expect.accepted} but contract computed accepted=${verdict.accepted} — ${verdict.reason}`);
    }
    results.push({ id: kase.id || kase._file, expected: kase.expect.accepted, actual: verdict.accepted, ok, reason: verdict.reason });
  }

  return { name, kind: stage.kind, n: stage.n, outFields, count: cases.length, results, ok: errors.length === 0, errors };
}

// CLI wrapper for a single stage: prints a per-case table and exits 0 (pass) / 1 (fail).
export function runStageCLI(name) {
  let r;
  try {
    r = certifyStage(name);
  } catch (e) {
    console.error(`certify:stage ${name} ERROR — ${e.message}`);
    process.exit(2);
  }
  console.log(`certify:stage ${name} (#${r.n}, ${r.kind}) — ${r.count} cases; fields: [${r.outFields.join(', ') || '—'}]`);
  for (const c of r.results) {
    console.log(`  ${c.ok ? 'OK  ' : 'FAIL'} ${c.id}  expect=${c.expected} actual=${c.actual}  ${c.reason || ''}`);
  }
  if (!r.ok) {
    for (const e of r.errors) console.error('  ! ' + e);
    console.error(`certify:stage ${name} FAIL`);
    process.exit(1);
  }
  console.log(`certify:stage ${name} PASS — all ${r.count} cases match their authored expectations.`);
  process.exit(0);
}
