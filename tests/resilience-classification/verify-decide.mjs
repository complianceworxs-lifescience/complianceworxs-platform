// M7A-03 — executes the shared decideFailure() composition against synthetic inputs.
// This is the "run the actual decision logic, not just a parity table" check: decideFailure is
// the exact function both irr-stage-engine and irr-job-worker call, so exercising it here
// exercises the real branch selection (retry vs terminal), ceiling exhaustion, the recorded
// delay, and the 429/auth subclassification. Expected outcomes authored from the design.
//
// Run: node --experimental-strip-types tests/resilience-classification/verify-decide.mjs [--json]
import { decideFailure } from '../../resilience/decide-failure.ts';

const JSON_OUT = process.argv.includes('--json');

// { reason, attempt, maxAttempts, context, expect: {action, reason_normalized, category, delay} }
// delay rule: 'zero' | 'positive' | 'retry_after'
const CASES = [
  { id: 'operational-retry', reason: 'network_error', attempt: 1, maxAttempts: 6,
    expect: { action: 'retry', reason_normalized: 'network_error', category: 'operational', delay: 'positive' } },
  { id: 'operational-exhausted-by-caller-ceiling', reason: 'network_error', attempt: 6, maxAttempts: 6,
    expect: { action: 'terminal', reason_normalized: 'network_error', category: 'operational', delay: 'zero' } },
  { id: 'model-retry', reason: 'invalid_json_output', attempt: 1, maxAttempts: 6,
    expect: { action: 'retry', reason_normalized: 'invalid_json_output', category: 'model_output', delay: 'positive' } },
  { id: 'contract-terminal', reason: 'contract_invalid', attempt: 1, maxAttempts: 6,
    expect: { action: 'terminal', reason_normalized: 'contract_invalid', category: 'contract', delay: 'zero' } },
  { id: 'business-schema-conflict-terminal', reason: 'invalid_response_schema', attempt: 1, maxAttempts: 6,
    expect: { action: 'terminal', reason_normalized: 'invalid_response_schema', category: 'business_logic', delay: 'zero' } },
  { id: 'ratelimit-429-retry-honors-retryafter', reason: 'api_error', attempt: 1, maxAttempts: 6, context: { httpStatus: 429, retryAfterMs: 5000 },
    expect: { action: 'retry', reason_normalized: 'rate_limit', category: 'operational', delay: 'retry_after' } },
  { id: 'auth-401-terminal', reason: 'api_error', attempt: 1, maxAttempts: 6, context: { httpStatus: 401 },
    expect: { action: 'terminal', reason_normalized: 'authentication_error', category: 'infrastructure', delay: 'zero' } },
  { id: 'provider-5xx-retry', reason: 'api_error', attempt: 2, maxAttempts: 6, context: { httpStatus: 503 },
    expect: { action: 'retry', reason_normalized: 'api_error', category: 'operational', delay: 'positive' } },
  { id: 'unknown-reason-failsafe-retry', reason: 'some_unmapped_reason', attempt: 1, maxAttempts: 6,
    expect: { action: 'retry', reason_normalized: 'some_unmapped_reason', category: 'operational', delay: 'positive' } },
];

const results = [];
const problems = [];
for (const c of CASES) {
  const d = decideFailure(c.reason, c.attempt, c.maxAttempts, c.context ?? {});
  const chk = [];
  if (d.action !== c.expect.action) chk.push(`action ${d.action}≠${c.expect.action}`);
  if (d.reason_normalized !== c.expect.reason_normalized) chk.push(`reason ${d.reason_normalized}≠${c.expect.reason_normalized}`);
  if (d.category !== c.expect.category) chk.push(`category ${d.category}≠${c.expect.category}`);
  if (c.expect.delay === 'zero' && d.delay_ms !== 0) chk.push(`delay_ms ${d.delay_ms}≠0`);
  if (c.expect.delay === 'positive' && !(d.delay_ms > 0)) chk.push(`delay_ms ${d.delay_ms} not > 0`);
  if (c.expect.delay === 'retry_after' && d.delay_ms !== (c.context?.retryAfterMs)) chk.push(`delay_ms ${d.delay_ms}≠retryAfter ${c.context?.retryAfterMs}`);
  const ok = chk.length === 0;
  if (!ok) problems.push({ id: c.id, chk });
  results.push({ id: c.id, ok, d });
}

if (JSON_OUT) { console.log(JSON.stringify({ ok: problems.length === 0, results }, null, 2)); }
else {
  console.log(`verify:decide — ${CASES.length} decideFailure() cases executed`);
  for (const r of results) console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${r.id.padEnd(38)} action=${r.d.action} reason=${r.d.reason_normalized} cat=${r.d.category} delay=${r.d.delay_ms}`);
}
if (problems.length) { console.error('verify:decide FAIL'); process.exit(1); }
if (!JSON_OUT) console.log(`verify:decide PASS — all ${CASES.length} decideFailure() decisions match authored expectations.`);
process.exit(0);
