// M7A-10 circuit-breaker fault-injection test (CW-MDR-007A §16 CP-A6).
// Executes the breaker against synthetic operational-failure sequences and proves:
//   * with the breaker ENABLED (injected config), it OPENS at the threshold, short-circuits
//     during cooldown to a normalized terminal reason, and closes/resets after cooldown or on
//     a success;
//   * with the SHIPPED config (BREAKER.enabled === false), it NEVER opens — specified but off.
// Deterministic: clock (nowMs) is injected, no wall-clock or randomness.
//
// Run: node --experimental-strip-types tests/resilience-classification/verify-breaker.mjs
import { circuitOpen, recordOutcome, CLOSED, CIRCUIT_OPEN_REASON } from '../../resilience/breaker.ts';
import { BREAKER } from '../../resilience/generated/resilience-generated.ts';

const ENABLED = { enabled: true, window_seconds: 60, consecutive_failures_threshold: 5, cooldown_seconds: 30, keyed_by: 'provider' };
const T0 = 1_000_000; // fixed synthetic epoch ms
const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };

// --- ENABLED: opens exactly at the threshold ---
let s = CLOSED;
for (let i = 1; i <= 4; i++) s = recordOutcome(s, 'operational_failure', T0, ENABLED);
check(!circuitOpen(s, T0, ENABLED), `below threshold (4 failures) must stay CLOSED, got open (consecutive=${s.consecutive_failures})`);
s = recordOutcome(s, 'operational_failure', T0, ENABLED); // 5th -> threshold
check(circuitOpen(s, T0, ENABLED), `at threshold (5 failures) must be OPEN`);
check(s.opened_at === T0, `opened_at must be set when the breaker opens`);

// --- ENABLED: open during cooldown, closed after ---
check(circuitOpen(s, T0 + 29_000, ENABLED), `must remain OPEN during cooldown (t+29s < 30s)`);
check(!circuitOpen(s, T0 + 31_000, ENABLED), `must be CLOSED after cooldown (t+31s > 30s)`);

// --- ENABLED: a success resets to closed ---
const reset = recordOutcome(s, 'success', T0 + 5_000, ENABLED);
check(reset.consecutive_failures === 0 && reset.opened_at === null, `a success must reset the breaker to closed`);

// --- SHIPPED config (enabled:false): never opens ---
check(BREAKER.enabled === false, `shipped BREAKER.enabled must be false (specified but off)`);
let off = CLOSED;
for (let i = 1; i <= 20; i++) off = recordOutcome(off, 'operational_failure', T0); // default config = BREAKER
check(!circuitOpen(off, T0), `shipped (disabled) breaker must NEVER open, even after 20 failures`);
check(off.opened_at === null, `disabled breaker must not record opened_at`);

// --- normalized terminal reason exists ---
check(CIRCUIT_OPEN_REASON === 'circuit_open', `open circuit must fast-fail with a normalized terminal reason`);

const rows = [
  ['enabled: 4 failures -> closed', !circuitOpen(recordSeq(4, ENABLED), T0, ENABLED)],
  ['enabled: 5 failures -> OPEN', circuitOpen(recordSeq(5, ENABLED), T0, ENABLED)],
  ['enabled: open during cooldown (t+29s)', circuitOpen(recordSeq(5, ENABLED), T0 + 29_000, ENABLED)],
  ['enabled: closed after cooldown (t+31s)', !circuitOpen(recordSeq(5, ENABLED), T0 + 31_000, ENABLED)],
  ['shipped(off): 20 failures -> never opens', !circuitOpen(off, T0)],
  [`normalized reason = "${CIRCUIT_OPEN_REASON}"`, CIRCUIT_OPEN_REASON === 'circuit_open'],
];
function recordSeq(n, cfg) { let st = CLOSED; for (let i = 0; i < n; i++) st = recordOutcome(st, 'operational_failure', T0, cfg); return st; }

console.log('verify:breaker — circuit-breaker fault injection (M7A-10)');
for (const [label, ok] of rows) console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`);
console.log(`  (shipped BREAKER.enabled = ${BREAKER.enabled} — specified but off, per DR A-06 "where justified")`);
if (problems.length) { for (const p of problems) console.error('  ! ' + p); console.error('verify:breaker FAIL'); process.exit(1); }
console.log('verify:breaker PASS — breaker opens at threshold when enabled, fast-fails during cooldown, resets on success; shipped config is off.');
process.exit(0);
