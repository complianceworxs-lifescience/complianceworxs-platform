// CW-MDR-008 M8-02 — continuous-loop decision certification with look-ahead hand-off
// (build step 3 + validation fix; CP-8.3 unit portion). Exercises planNext() against the full
// decision matrix so the worker loop's control flow — including the "at most one AI stage per
// invocation" look-ahead — is proven deterministically, without a live edge runtime. (Integration
// behavior — clean 15-stage completion and resume-after-kill — is verified at deploy time.)
//
// Run: node --experimental-strip-types tests/execution-engine/verify-plan-next.mjs
import { planNext } from '../../edge-functions/irr-stage-engine/plan-next.ts';

const N = 15;
const problems = [];
const check = (got, want, label) => { if (got !== want) problems.push(`${label}: expected "${want}", got "${got}"`); };

// terminal / retry dominate regardless of look-ahead args
check(planNext('terminal', 5, N, true, true), 'stop', 'terminal');
check(planNext('terminal', 5, N, false, false), 'stop', 'terminal (code next, no ai)');
check(planNext('retry', 5, N, true, false), 'retry', 'retry');
check(planNext('retry', 5, N, false, true), 'retry', 'retry (ai already ran)');

// last stage completed -> complete the job (beats any hand-off)
check(planNext('completed', 15, N, false, true), 'complete_job', 'last stage');
check(planNext('completed', 16, N, true, true), 'complete_job', 'beyond last stage');

// LOOK-AHEAD: next stage is AI and this invocation already ran an AI stage -> hand off
check(planNext('completed', 6, N, true, true), 'handoff', 'ai-next + ai-already-ran -> handoff');
// next stage is AI but NO ai stage ran yet this invocation -> advance (run it fresh)
check(planNext('completed', 3, N, true, false), 'advance', 'ai-next + fresh invocation -> advance');
// next stage is a CODE stage -> always advance (chain), regardless of whether an ai stage ran
check(planNext('completed', 11, N, false, true), 'advance', 'code-next after an ai stage -> chain');
check(planNext('completed', 1, N, false, false), 'advance', 'code-next, fresh -> chain');

const rows = [
  ['terminal -> stop', planNext('terminal', 5, N, true, true) === 'stop'],
  ['retry -> retry', planNext('retry', 5, N, true, true) === 'retry'],
  ['last stage -> complete_job', planNext('completed', N, N, false, true) === 'complete_job'],
  ['2nd AI stage in an invocation -> handoff', planNext('completed', 6, N, true, true) === 'handoff'],
  ['1st AI stage (fresh) -> advance', planNext('completed', 3, N, true, false) === 'advance'],
  ['code stage -> advance (chain)', planNext('completed', 11, N, false, true) === 'advance'],
];

console.log('verify:plan-next — continuous-loop decision matrix w/ look-ahead hand-off (M8-02 / CP-8.3)');
for (const [label, ok] of rows) console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`);
if (problems.length) { for (const p of problems) console.error('  ! ' + p); console.error('verify:plan-next FAIL'); process.exit(1); }
console.log('verify:plan-next PASS — one AI stage per invocation enforced; code stages chain; terminal/retry/complete honored.');
process.exit(0);
