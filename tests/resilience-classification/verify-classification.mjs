// M7A-03/M7A-11 classification certification (CW-MDR-007A §16 CP-A2).
//
// Runs the real evaluate() over AUTHORED canonical cases and asserts each decision matches the
// author's expected outcome — no model calls, and expected outcomes are authored from the
// design (taxonomy/policy + the subclassification rules), never derived from running the code
// (same discipline as M7 stage certification). Delay is checked by an AUTHORED rule
// (zero / retry_after / backoff-bounds), not a magic number.
//
// Run:   node --experimental-strip-types tests/resilience-classification/verify-classification.mjs [--json|--emit]
//   --emit  print the canonical decision set (stable order) — used by the two-run determinism proof.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluate } from '../../resilience/evaluate-policy.ts';
import { POLICY } from '../../resilience/generated/resilience-generated.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = join(HERE, 'cases');
const JSON_OUT = process.argv.includes('--json');
const EMIT = process.argv.includes('--emit');

// Authored backoff bound for a category+attempt, computed from POLICY (the design source).
function backoffBounds(category, attempt) {
  const p = POLICY[category];
  const base = Math.min(p.backoff_cap_ms, p.backoff_base_ms * Math.pow(2, attempt - 1));
  return [Math.round(base * (1 - p.jitter_ratio)), Math.round(base * (1 + p.jitter_ratio))];
}

const cases = readdirSync(CASES).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(CASES, f), 'utf8')) }));
if (!cases.length) { console.error('verify:classification FAIL — no cases under tests/resilience-classification/cases/.'); process.exit(1); }

const decisions = [];
const results = [];
const problems = [];
const categoriesSeen = new Set();

for (const c of cases) {
  const ctx = c.input.context ?? {};
  const d = evaluate(c.input.reason, c.input.attempt, ctx);
  decisions.push({ id: c.id, ...d });
  categoriesSeen.add(d.category);
  const e = c.expect;
  const chk = [];
  if (d.category !== e.category) chk.push(`category ${d.category}≠${e.category}`);
  if (d.reason_normalized !== e.reason_normalized) chk.push(`reason ${d.reason_normalized}≠${e.reason_normalized}`);
  if (d.retry !== e.retry) chk.push(`retry ${d.retry}≠${e.retry}`);
  if (d.terminal !== e.terminal) chk.push(`terminal ${d.terminal}≠${e.terminal}`);
  if ('honor_retry_after' in e && d.honor_retry_after !== e.honor_retry_after) chk.push(`honor_retry_after ${d.honor_retry_after}≠${e.honor_retry_after}`);
  if ('max_attempts' in e && d.max_attempts !== e.max_attempts) chk.push(`max_attempts ${d.max_attempts}≠${e.max_attempts}`);
  if (e.delay === 'zero') { if (d.delayMs !== 0) chk.push(`delayMs ${d.delayMs}≠0`); }
  else if (e.delay === 'retry_after') { const ra = ctx.retryAfterMs; if (d.delayMs !== ra) chk.push(`delayMs ${d.delayMs}≠retryAfter ${ra}`); }
  else if (e.delay === 'backoff') { const [lo, hi] = backoffBounds(d.category, c.input.attempt); if (d.delayMs < lo || d.delayMs > hi) chk.push(`delayMs ${d.delayMs} ∉ backoff [${lo},${hi}]`); }
  else chk.push(`unknown delay rule "${e.delay}"`);
  const ok = chk.length === 0;
  if (!ok) problems.push({ id: c.id, chk });
  results.push({ id: c.id, category: d.category, ok, chk });
}

// coverage guard: all 5 categories exercised (§7.4)
const REQUIRED = ['contract', 'business_logic', 'model_output', 'operational', 'infrastructure'];
const missing = REQUIRED.filter((c) => !categoriesSeen.has(c));
if (missing.length) problems.push({ id: '(coverage)', chk: [`categories never exercised: ${missing.join(', ')}`] });

if (EMIT) {
  const canonical = [...decisions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  console.log(JSON.stringify(canonical, null, 2));
  process.exit(0);
}

const report = { gate: 'CP-A2 / verify:classification', ok: problems.length === 0, total: cases.length, categories: [...categoriesSeen].sort(), problems };
if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`verify:classification — ${cases.length} cases; categories exercised: [${[...categoriesSeen].sort().join(', ')}]`);
  for (const r of results) console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${r.id.padEnd(30)} ${r.category}${r.ok ? '' : '  — ' + r.chk.join('; ')}`);
  if (missing.length) console.error(`  ! categories never exercised: ${missing.join(', ')}`);
}
if (problems.length) { console.error('verify:classification FAIL'); process.exit(1); }
if (!JSON_OUT) console.log(`verify:classification PASS — all ${cases.length} cases match authored expectations; all 5 categories exercised.`);
process.exit(0);
