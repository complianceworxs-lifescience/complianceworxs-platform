// CW-MDR-008 M8-02 — continuous-loop decision certification (build step 3; CP-8.3 unit portion).
// Exercises planNext() against the full decision matrix so the worker loop's control flow is
// proven deterministically, without a live edge runtime. (Integration behavior — zero-cron
// completion and resume-after-kill — is verified at deploy time / via a live harness, owner-gated.)
//
// Run: node --experimental-strip-types tests/execution-engine/verify-plan-next.mjs
import { planNext } from '../../edge-functions/irr-stage-engine/plan-next.ts';

const N = 15;                 // stage count
const B = 240_000;            // soft budget ms
const problems = [];
const check = (got, want, label) => { if (got !== want) problems.push(`${label}: expected "${want}", got "${got}"`); };

// terminal always stops, regardless of stage/time
check(planNext('terminal', 5, N, 0, B), 'stop', 'terminal mid-pipeline');
check(planNext('terminal', 15, N, 0, B), 'stop', 'terminal at last stage');

// retry always self-reinvokes, regardless of budget
check(planNext('retry', 5, N, 0, B), 'retry', 'retry under budget');
check(planNext('retry', 5, N, B + 1, B), 'retry', 'retry over budget');

// completed, more stages remain, under budget -> advance in-invocation (no cron gap)
check(planNext('completed', 1, N, 0, B), 'advance', 'completed stage 1, fresh');
check(planNext('completed', 14, N, B - 1, B), 'advance', 'completed stage 14, just under budget');

// completed, more stages remain, at/over budget -> hand off (self-reinvoke)
check(planNext('completed', 5, N, B, B), 'handoff', 'budget exactly hit (>= boundary)');
check(planNext('completed', 5, N, B + 5000, B), 'handoff', 'budget exceeded');

// completed the LAST stage -> complete the job (takes priority over budget/handoff)
check(planNext('completed', 15, N, 0, B), 'complete_job', 'last stage under budget');
check(planNext('completed', 15, N, B + 1, B), 'complete_job', 'last stage over budget still completes');

// defensive: a completedStage beyond the count still completes (never advances past the end)
check(planNext('completed', 16, N, 0, B), 'complete_job', 'beyond last stage');

const rows = [
  ['terminal -> stop', planNext('terminal', 5, N, 0, B) === 'stop'],
  ['retry -> retry (self-reinvoke)', planNext('retry', 5, N, 0, B) === 'retry'],
  ['completed + under budget -> advance', planNext('completed', 3, N, 1000, B) === 'advance'],
  ['completed + budget hit -> handoff', planNext('completed', 3, N, B, B) === 'handoff'],
  ['last stage -> complete_job', planNext('completed', N, N, 0, B) === 'complete_job'],
];

console.log('verify:plan-next — continuous-loop decision matrix (M8-02 / CP-8.3)');
for (const [label, ok] of rows) console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`);
if (problems.length) { for (const p of problems) console.error('  ! ' + p); console.error('verify:plan-next FAIL'); process.exit(1); }
console.log('verify:plan-next PASS — all decision-matrix cases match; completion beats handoff; terminal/retry honored.');
process.exit(0);
