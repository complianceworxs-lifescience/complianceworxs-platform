// CW-MDR-008 M8-11 — stage dependency graph certification (build step 2; gate CP-8.2).
//
// Proves the DECLARED graph (execution-graph/stage-graph.json) matches the ACTUAL data
// dependencies in the engine — i.e. the `prior[N]` reads inside each stage's run() body in
// edge-functions/irr-stage-engine/index.ts. This is the M8-11 gate that must be green BEFORE any
// parallel-execution work (build step 5): parallelizing on an undeclared/incorrect graph is a
// non-acceptance condition (CW-MDR-008 §20 N-04).
//
// Checks:
//   1. stage set + names match the engine's STAGES array exactly;
//   2. each stage's declared depends_on == the set of prior[N] it actually reads (set equality);
//   3. no forward/self references (every dep < stage) -> the graph is a DAG;
//   4. computes and prints the DATA-dependency waves (the parallelism ceiling).
//
// Dependency-free (pure Node, JSON manifest) so it runs from a clean clone with zero bootstrap.
// Run: node execution-graph/verify.js
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const ENGINE = join(REPO, 'edge-functions', 'irr-stage-engine', 'index.ts');
const MANIFEST = join(HERE, 'stage-graph.json');

const problems = [];
const fail = (m) => problems.push(m);
const eqSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// --- load declared graph ---
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const declared = new Map();
for (const s of manifest.stages) declared.set(s.stage, { name: s.name, deps: [...s.depends_on].sort((a, b) => a - b) });

// --- extract actual data dependencies from the engine ---
const src = readFileSync(ENGINE, 'utf8');
const lines = src.split('\n');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

// locate each stage entry: `{ stage: N, name: 'X', ...`
const starts = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/\{\s*stage:\s*(\d+),\s*name:\s*'([^']+)'/);
  if (m) starts.push({ stage: Number(m[1]), name: m[2], line: i });
}
if (!starts.length) { console.error('verify:graph FAIL — no STAGES entries found in the engine.'); process.exit(1); }
// end of the STAGES array literal: the first line that is exactly `];`
let endLine = lines.length;
for (let i = starts[starts.length - 1].line; i < lines.length; i++) { if (/^\];\s*$/.test(lines[i])) { endLine = i; break; } }
const bounds = [...starts, { stage: null, line: endLine }];

const actual = new Map();
for (let k = 0; k < bounds.length - 1; k++) {
  const st = bounds[k];
  const body = stripComments(lines.slice(st.line, bounds[k + 1].line).join('\n'));
  const deps = new Set();
  for (const mm of body.matchAll(/prior\s*\??\.?\s*\[\s*(\d+)\s*\]/g)) deps.add(Number(mm[1]));
  deps.delete(st.stage); // ignore any self-reference
  actual.set(st.stage, { name: st.name, deps: [...deps].sort((a, b) => a - b) });
}

// --- check 1: stage set + names match ---
const dStages = [...declared.keys()].sort((a, b) => a - b);
const aStages = [...actual.keys()].sort((a, b) => a - b);
if (!eqSet(dStages, aStages)) fail(`stage set mismatch: declared [${dStages}] vs engine [${aStages}]`);
for (const s of aStages) {
  if (declared.has(s) && declared.get(s).name !== actual.get(s).name)
    fail(`stage ${s} name mismatch: declared "${declared.get(s).name}" vs engine "${actual.get(s).name}"`);
}

// --- check 2: declared deps == actual reads ---
const rows = [];
for (const s of aStages) {
  const dec = declared.get(s)?.deps ?? [];
  const act = actual.get(s).deps;
  const ok = eqSet(dec, act);
  if (!ok) {
    const missing = act.filter((x) => !dec.includes(x));   // read by code but not declared
    const extra = dec.filter((x) => !act.includes(x));     // declared but not read
    fail(`stage ${s} (${actual.get(s).name}) dependency mismatch — declared [${dec}] vs actual [${act}]`
      + (missing.length ? `; UNDECLARED reads: [${missing}]` : '')
      + (extra.length ? `; declared-but-unread: [${extra}]` : ''));
  }
  rows.push({ s, name: actual.get(s).name, deps: act, ok });
}

// --- check 3: no forward/self references (=> DAG) ---
for (const s of aStages) for (const d of actual.get(s).deps) if (d >= s) fail(`stage ${s} has a forward/self dependency on ${d} (must read only earlier stages)`);

// --- data-dependency waves (parallelism ceiling) ---
const level = new Map();
const levelOf = (s) => {
  if (level.has(s)) return level.get(s);
  const deps = (actual.get(s)?.deps ?? []);
  const L = deps.length ? Math.max(...deps.map(levelOf)) + 1 : 0;
  level.set(s, L); return L;
};
for (const s of aStages) levelOf(s);
const waves = new Map();
for (const s of aStages) { const L = level.get(s); (waves.get(L) ?? waves.set(L, []).get(L)).push(s); }

// --- report ---
console.log('verify:graph — declared stage dependency graph vs engine reads (M8-11 / CP-8.2)');
for (const r of rows) console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} stage ${String(r.s).padStart(2)} ${r.name.padEnd(24)} depends_on [${r.deps.join(', ')}]`);
console.log('  data-dependency waves (parallelism ceiling — control/gating overlaid separately at execution):');
for (const L of [...waves.keys()].sort((a, b) => a - b)) console.log(`    wave ${L}: {${waves.get(L).sort((a, b) => a - b).join(', ')}}`);
console.log(`  critical-path depth = ${waves.size} waves across ${aStages.length} stages.`);

if (problems.length) { for (const p of problems) console.error('  ! ' + p); console.error('verify:graph FAIL'); process.exit(1); }
console.log('verify:graph PASS — declared graph matches the engine\'s actual prior[N] reads; acyclic; no forward refs.');
process.exit(0);
