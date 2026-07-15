// M7-10 / M7-11 — regression corpus runner (build step 5; DR §12, §17; gate CP-5).
//
// Runs the immutable, content-addressed corpus (tests/regression-corpus/) through the
// real runtime in an ISOLATED sandbox (same proven technique as verify:smoke — byte-for-
// byte runtime logic + value-shimmed empty type modules + a network-egress guard), and
// produces an attributable regression run: a unique run_id, per-case results, an aggregate
// pass/fail, and a corpus hash. Membership is defined ONLY by the corpus index (no shared
// production-table time window). The runtime path writes to NO production job table.
//
// Usage:
//   node --experimental-strip-types verification/regression/run-regression.js [--json] [--sql] [--reindex]
//     (default)   run the corpus, print a human report, exit 0 iff every case matches its
//                 expected terminal result and the corpus is immutable vs index.json
//     --json      print the machine-readable run report (run_id, per-case, aggregate)
//     --sql       print the INSERT statements that persist THIS run into the isolated
//                 m7_regression_runs / m7_regression_case_results tables (and nothing else)
//     --reindex   regenerate tests/regression-corpus/index.json from the current case files
//                 (the sanctioned, deliberate corpus-version bump; not part of a normal run)
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { newRunId, sha256Hex, computeCorpusHash, selectMembership } from './isolation.js';

const HERE = dirname(fileURLToPath(import.meta.url));       // verification/regression
const REPO = resolve(HERE, '..', '..');
const RT = join(REPO, 'edge-functions', 'runtime');
const CORPUS = join(REPO, 'tests', 'regression-corpus');
const CASES_DIR = join(CORPUS, 'cases');
const INDEX_PATH = join(CORPUS, 'index.json');
const VERSION_PATH = join(CORPUS, 'corpus.version');

const FLAG = (f) => process.argv.includes(f);
const LOGIC_FILES = ['runtime.ts', 'checksum-util.ts', 'response-parser.ts', 'schema-validator.ts', 'runtime-manifest.ts'];
const SHIMS = {
  'prompt-schema.ts': 'export const PromptPackage = undefined;\nexport const OutputSchema = undefined;\n',
  'adapter.ts': 'export const RuntimeAdapter = undefined;\nexport const AdapterResponse = undefined;\n',
  'types.ts': 'export const RuntimeConfiguration = undefined;\nexport const RuntimeResult = undefined;\nexport const RuntimeIssue = undefined;\nexport const ExecutionLogEntry = undefined;\nexport const RuntimeManifest = undefined;\n',
};
const DB_MARKERS = /supabase|createClient|\bpostgres\b|node:net|node:tls|serviceRole|SUPABASE_|irr_jobs|irr_stage_runs|irr_regression_runs|\.from\(/i;

function fail(msg) { console.error('verify:regression FAIL — ' + msg); process.exit(1); }
function sqlStr(v) { return v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`; }

// --- read corpus + case files ---------------------------------------------------------
const corpusVersion = readFileSync(VERSION_PATH, 'utf8').trim();
const caseFiles = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json')).sort();
if (!caseFiles.length) fail('no corpus cases under tests/regression-corpus/cases/.');
const caseHashes = {};
const cases = {};
for (const f of caseFiles) {
  const raw = readFileSync(join(CASES_DIR, f));            // hash the exact bytes on disk
  const obj = JSON.parse(raw.toString('utf8'));
  if (obj.case_id + '.json' !== f) fail(`case file "${f}" does not match its case_id "${obj.case_id}" (case_id must equal filename).`);
  caseHashes[obj.case_id] = sha256Hex(raw);
  cases[obj.case_id] = obj;
}

// --- --reindex: deliberate corpus-version bump ---------------------------------------
if (FLAG('--reindex')) {
  const index = { corpus_version: corpusVersion, corpus_hash: computeCorpusHash(caseHashes), cases: caseHashes };
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n');
  console.log(`reindexed ${caseFiles.length} cases -> index.json  (corpus ${corpusVersion}, hash ${index.corpus_hash.slice(0, 16)}…)`);
  process.exit(0);
}

// --- immutability gate (N-06): case bytes must match index.json exactly ---------------
let index;
try { index = JSON.parse(readFileSync(INDEX_PATH, 'utf8')); }
catch { fail('tests/regression-corpus/index.json missing or unreadable — run with --reindex to create it.'); }
if (index.corpus_version !== corpusVersion) fail(`corpus.version "${corpusVersion}" != index corpus_version "${index.corpus_version}".`);
const idxIds = Object.keys(index.cases).sort();
const diskIds = Object.keys(caseHashes).sort();
if (JSON.stringify(idxIds) !== JSON.stringify(diskIds)) fail(`corpus membership drift: index=[${idxIds}] disk=[${diskIds}] — a case was added/removed without a --reindex bump.`);
for (const id of diskIds) {
  if (caseHashes[id] !== index.cases[id]) fail(`case "${id}" was edited in place (hash ${caseHashes[id].slice(0, 12)}… != index ${String(index.cases[id]).slice(0, 12)}…) without a --reindex bump (N-06).`);
}
const recomputedCorpusHash = computeCorpusHash(caseHashes);
if (recomputedCorpusHash !== index.corpus_hash) fail(`corpus_hash drift: recomputed ${recomputedCorpusHash.slice(0, 16)}… != index ${String(index.corpus_hash).slice(0, 16)}…`);

// --- membership is corpus-scoped (no production time window) --------------------------
const membership = selectMembership(index);

// --- build the isolated runtime sandbox ----------------------------------------------
const box = mkdtempSync(join(tmpdir(), 'cw-regression-'));
try {
  const logicHashes = {};
  const dbHits = [];
  for (const f of LOGIC_FILES) {
    const src = readFileSync(join(RT, f));
    writeFileSync(join(box, f), src);
    logicHashes[f] = sha256Hex(src);
    if (DB_MARKERS.test(src.toString('utf8'))) dbHits.push(f);
  }
  for (const [f, body] of Object.entries(SHIMS)) writeFileSync(join(box, f), body);
  writeFileSync(join(box, 'smoke-adapter.ts'), readFileSync(join(REPO, 'verification', 'smoke', 'smoke-adapter.ts')));
  if (dbHits.length) fail(`runtime logic references a persistence/DB marker: [${dbHits.join(', ')}] — regression is NOT isolated.`);

  const { executePromptPackage } = await import(pathToFileURL(join(box, 'runtime.ts')).href);
  const { smokeAdapter } = await import(pathToFileURL(join(box, 'smoke-adapter.ts')).href);
  const { sha256 } = await import(pathToFileURL(join(box, 'checksum-util.ts')).href);
  const adapters = { smoke: smokeAdapter };

  const fetchCalls = [];
  const fetchGuard = async (url) => { fetchCalls.push(String(url)); throw new Error(`REGRESSION ISOLATION VIOLATION: network egress to ${url}`); };

  function buildPackage(payload) {
    const pkg = JSON.parse(JSON.stringify(payload.promptPackage));
    if (payload.injectResponse !== undefined) pkg.__smokeResponse__ = payload.injectResponse;
    const { manifest, ...rest } = pkg;
    const { timestamp, checksum, ...manifestBase } = manifest || {};
    pkg.manifest = { ...manifest, checksum: sha256({ ...rest, manifest: manifestBase }) };
    return pkg;
  }

  const runId = newRunId();
  const startedAt = new Date().toISOString();
  const results = [];
  for (const caseId of membership.case_ids) {
    const c = cases[caseId];
    const pkg = buildPackage(c.payload);
    const result = await executePromptPackage(pkg, c.payload.userVariables ?? {}, { model: 'smoke-model', maxTokens: 4096, apiKey: '' }, adapters, fetchGuard);
    const actualStatus = result.status;
    const actualReason = result.issues && result.issues[0] ? result.issues[0].reason : null;
    const exp = c.expected || {};
    const statusOk = actualStatus === exp.status;
    const reasonOk = exp.reason === undefined || actualReason === exp.reason;
    const outcome = statusOk && reasonOk ? 'pass' : 'fail';
    results.push({
      case_id: caseId, scenario: c.scenario ?? null, stage: c.stage ?? null,
      expected_status: exp.status ?? null, expected_reason: exp.reason ?? null,
      actual_status: actualStatus, actual_reason: actualReason, outcome,
      error_detail: outcome === 'fail' ? `expected ${exp.status}/${exp.reason ?? '*'}, got ${actualStatus}/${actualReason ?? '-'}` : null,
    });
  }
  const completedAt = new Date().toISOString();
  const passed = results.filter((r) => r.outcome === 'pass').length;
  const failed = results.length - passed;
  const aggregate = failed === 0 ? 'pass' : 'fail';

  const report = {
    gate: 'CP-5 / verify:regression',
    run_id: runId,
    corpus_version: corpusVersion,
    corpus_hash: index.corpus_hash,
    membership: { source: membership.source, case_ids: membership.case_ids },
    isolation: {
      productionTablesRead: false, productionTablesWritten: false,
      db_persistence_markers_in_runtime_logic: dbHits,          // []
      network_egress_calls: fetchCalls.length,                  // 0
      membership_from_production_time_window: false,
      executed_logic_sha256: logicHashes,
    },
    started_at: startedAt, completed_at: completedAt,
    total: results.length, passed, failed, aggregate,
    cases: results,
  };

  // --- --sql: emit persistence for the ISOLATED m7 tables ONLY ------------------------
  if (FLAG('--sql')) {
    const lines = [];
    lines.push('BEGIN;');
    lines.push(`INSERT INTO public.m7_regression_runs (run_id, corpus_version, corpus_hash, status, total, passed, failed, started_at, completed_at) VALUES (${sqlStr(runId)}, ${sqlStr(corpusVersion)}, ${sqlStr(index.corpus_hash)}, ${sqlStr(aggregate)}, ${results.length}, ${passed}, ${failed}, ${sqlStr(startedAt)}, ${sqlStr(completedAt)});`);
    for (const r of results) {
      lines.push(`INSERT INTO public.m7_regression_case_results (run_id, case_id, scenario, stage, expected_status, actual_status, outcome, error_detail) VALUES (${sqlStr(runId)}, ${sqlStr(r.case_id)}, ${sqlStr(r.scenario)}, ${sqlStr(r.stage)}, ${sqlStr(r.expected_status)}, ${sqlStr(r.actual_status)}, ${sqlStr(r.outcome)}, ${sqlStr(r.error_detail)});`);
    }
    lines.push('COMMIT;');
    console.log(lines.join('\n'));
    process.exit(0);
  }

  if (FLAG('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`verify:regression — run_id=${runId}`);
    console.log(`  corpus ${corpusVersion} (hash ${index.corpus_hash.slice(0, 16)}…), membership: ${membership.source}`);
    console.log(`  isolation: db-markers=[${dbHits.join(', ') || 'none'}]  network-egress=${fetchCalls.length}  prod-tables-read/written=NO`);
    for (const r of results) console.log(`  ${r.outcome === 'pass' ? 'PASS' : 'FAIL'} ${r.case_id.padEnd(26)} expect=${r.expected_status}/${r.expected_reason ?? '*'}  actual=${r.actual_status}/${r.actual_reason ?? '-'}`);
    console.log(`  aggregate: ${aggregate.toUpperCase()}  (${passed}/${results.length} passed, ${failed} failed)`);
  }
  if (fetchCalls.length !== 0) fail(`network egress during regression: ${fetchCalls.length} (must be 0).`);
  if (aggregate !== 'pass') fail(`${failed} case(s) did not match their expected terminal result.`);
  if (!FLAG('--json')) console.log('verify:regression PASS — attributable run_id, per-case results, aggregate PASS, corpus-scoped membership, zero production-table access.');
  process.exit(0);
} finally {
  rmSync(box, { recursive: true, force: true });
}
