// M7-12 — one-command verification orchestrator (`npm run verify`; DR §8 / §6.5).
//
// Performs, as applicable: (1) compile contracts + (2) verify generated artifacts
// [verify:compiler], (3) run unit tests [generated validator/prompt tests], (4) identify
// modified stages [detect-changes], (5) run relevant stage certification [+ smoke], and
// — for shared-infra / release-candidate changes — full regression; then (6) produces one
// unambiguous report (human + JSON). Gates are auto-selected from the diff (M7-01); the
// individual verify:* scripts remain separately runnable.
//
// Usage:
//   node --experimental-strip-types verification/verify.js [--diff "a,b,c"] [--base <ref>] [--rc] [--json]
//     --diff   simulate a changed-path set (comma/newline separated) — used by CP-6
//     --base   derive changes from `git diff --name-only <ref>`
//     (default) `git diff --name-only HEAD` (uncommitted) ∪ last commit's files
//     --rc     treat as a release candidate (forces full regression)
//     --json   emit the machine-readable report only
import { spawnSync, execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { detectChanges } from './detect-changes.js';
import { buildReport, renderHuman } from './report.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const STRIP = '--experimental-strip-types';
const JSON_OUT = process.argv.includes('--json');
const arg = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : undefined; };

function changedPaths() {
  const d = arg('--diff');
  if (d !== undefined) return d.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  if (process.env.CW_VERIFY_DIFF) return process.env.CW_VERIFY_DIFF.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const base = arg('--base');
  try {
    if (base) return execFileSync('git', ['diff', '--name-only', base], { cwd: REPO }).toString().split('\n').map((s) => s.trim()).filter(Boolean);
    const uncommitted = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: REPO }).toString().split('\n');
    const lastCommit = execFileSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], { cwd: REPO }).toString().split('\n');
    return [...new Set([...uncommitted, ...lastCommit].map((s) => s.trim()).filter(Boolean))];
  } catch { return []; }
}

function run(name, args, { flags = [] } = {}) {
  const t0 = process.hrtime.bigint();
  const res = spawnSync(process.execPath, [...flags, ...args], { cwd: REPO, encoding: 'utf8' });
  const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
  const out = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').filter(Boolean);
  const ok = res.status === 0;
  const summary = out.length ? out[out.length - 1].slice(0, 100) : (ok ? 'ok' : `exit ${res.status}`);
  return { name, ok, ms, summary, code: res.status, output: out.join('\n') };
}

const plan = detectChanges(changedPaths(), { releaseCandidate: process.argv.includes('--rc') || process.env.CW_RELEASE_CANDIDATE === '1' });
const runId = randomUUID();
const startedAt = new Date().toISOString();
const t0 = process.hrtime.bigint();
const gates = [];

// (1)+(2) compile + verify generated artifacts
gates.push(run('verify:compiler', [join('compiler', 'verify.js')]));

// (3) unit tests — generated validator + prompt-fragment tests
const genDir = join(REPO, 'tests', 'generated');
const genTests = existsSync(genDir) ? readdirSync(genDir).filter((f) => f.endsWith('.mjs')).map((f) => join('tests', 'generated', f)) : [];
if (genTests.length) gates.push(run('unit:generated', ['--test', ...genTests], { flags: [STRIP] }));

// (4)+(5) modified-stage certification
for (const stage of plan.gates.stages) {
  gates.push(run(`verify:stage ${stage}`, [join('tests', 'stage-certification', 'verify-stage.mjs'), stage], { flags: [STRIP] }));
}

// smoke — one complete execution when a stage changed (or RC/regression)
if (plan.gates.smoke) gates.push(run('verify:smoke', [join('verification', 'smoke', 'run-smoke.js')], { flags: [STRIP] }));

// full regression — shared-infra / release candidate
if (plan.gates.regression) gates.push(run('verify:regression', [join('verification', 'regression', 'run-regression.js')], { flags: [STRIP] }));

// M7A resilience gates — taxonomy integrity + classification/decide/breaker certification
// (fires when resilience/ or the refactored engine/worker code changed, or on a release candidate).
if (plan.gates.resilience) {
  gates.push(run('verify:taxonomy', [join('resilience', 'verify.js')]));
  gates.push(run('verify:classification', [join('tests', 'resilience-classification', 'verify-classification.mjs')], { flags: [STRIP] }));
  gates.push(run('verify:decide', [join('tests', 'resilience-classification', 'verify-decide.mjs')], { flags: [STRIP] }));
  gates.push(run('verify:breaker', [join('tests', 'resilience-classification', 'verify-breaker.mjs')], { flags: [STRIP] }));
}

// M8 execution-engine gates — stage dependency graph (M8-11) + continuous-loop decision (M8-02).
// Fire when execution-graph/ or the stage engine changed, or on a release candidate.
if (plan.gates.graph) {
  gates.push(run('verify:graph', [join('execution-graph', 'verify.js')]));
  gates.push(run('verify:plan-next', [join('tests', 'execution-engine', 'verify-plan-next.mjs')], { flags: [STRIP] }));
}

const totalMs = Number((process.hrtime.bigint() - t0) / 1000000n);
const report = buildReport({ runId, plan, gates, startedAt, totalMs });

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(renderHuman(report));
  // surface failing gate output for quick diagnosis
  for (const g of gates) if (!g.ok) { console.error(`\n--- ${g.name} output ---\n${g.output}`); }
}
process.exit(report.overall === 'pass' ? 0 : 1);
