// M7-09 / M7-14 — smoke / runtime-stage certification runner (build step 4; DR §12, §16).
//
// Drives ONE COMPLETE EXECUTION through the real runtime (edge-functions/runtime/runtime.ts
// `executePromptPackage`) for each fixture smoke case, offline and deterministically, and
// proves the execution is ISOLATED from production (CP-4 / R-04 / N-05):
//
//   * No production job tables touched. The runtime is a pure function: it receives the
//     Prompt Package by value and returns a RuntimeResult by value. It imports no Supabase
//     client and no DB driver (asserted below by scanning the exact logic files that run).
//   * No network egress. The runtime's `fetchImpl` seam is passed a GUARD that records and
//     throws on any call; the smoke adapter makes no external model call, so the guard
//     count stays 0 for the whole suite.
//   * Isolated run_id per case (`smoke-<uuid>`), never persisted anywhere.
//
// How the real runtime is exercised under Node: the deployed runtime is Deno TypeScript
// whose three type-only companion modules (prompt-schema.ts, adapter.ts, types.ts) are
// EMPTY in production (Deno elides type-only imports). Node's type-stripping does not, so
// this runner assembles a throwaway sandbox: the 5 LOGIC files are copied BYTE-FOR-BYTE
// from edge-functions/runtime/ (their sha256 is recorded in the report as proof the
// executed bytes are the deployed bytes) and the 3 empty type modules are replaced with
// value-shims that satisfy ESM linking without contributing any behaviour.
//
// Usage:
//   node --experimental-strip-types verification/smoke/run-smoke.js [--json]
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));     // verification/smoke
const REPO = resolve(HERE, '..', '..');                   // repo root
const RT = join(REPO, 'edge-functions', 'runtime');       // the deployed runtime source
const CASES_DIR = join(HERE, 'cases');
const JSON_OUT = process.argv.includes('--json');

const LOGIC_FILES = ['runtime.ts', 'checksum-util.ts', 'response-parser.ts', 'schema-validator.ts', 'runtime-manifest.ts'];
// Empty-in-production type modules → value shims (names only; no behaviour).
const SHIMS = {
  'prompt-schema.ts': 'export const PromptPackage = undefined;\nexport const OutputSchema = undefined;\n',
  'adapter.ts': 'export const RuntimeAdapter = undefined;\nexport const AdapterResponse = undefined;\n',
  'types.ts': 'export const RuntimeConfiguration = undefined;\nexport const RuntimeResult = undefined;\nexport const RuntimeIssue = undefined;\nexport const ExecutionLogEntry = undefined;\nexport const RuntimeManifest = undefined;\n',
};
// Any of these appearing in a runtime logic file would mean the runtime can reach a DB /
// production table. The runtime must contain NONE of them.
const DB_MARKERS = /supabase|createClient|\bpostgres\b|node:net|node:tls|serviceRole|SUPABASE_|irr_jobs|irr_stage_runs|\.from\(/i;

function sha(buf) { return createHash('sha256').update(buf).digest('hex'); }
function fail(msg) { console.error('verify:smoke FAIL — ' + msg); process.exit(1); }

// --- build the isolated sandbox ------------------------------------------------------
const box = mkdtempSync(join(tmpdir(), 'cw-smoke-'));
const logicHashes = {};
const dbHits = [];
try {
  for (const f of LOGIC_FILES) {
    const src = readFileSync(join(RT, f));
    writeFileSync(join(box, f), src);          // byte-for-byte copy of deployed logic
    logicHashes[f] = sha(src);
    if (DB_MARKERS.test(src.toString('utf8'))) dbHits.push(f);
  }
  for (const [f, body] of Object.entries(SHIMS)) writeFileSync(join(box, f), body);
  writeFileSync(join(box, 'smoke-adapter.ts'), readFileSync(join(HERE, 'smoke-adapter.ts')));

  if (dbHits.length) fail(`runtime logic references a persistence/DB marker: [${dbHits.join(', ')}] — smoke is NOT isolated.`);

  // --- load the real runtime + the smoke adapter from the sandbox --------------------
  const { executePromptPackage } = await import(pathToFileURL(join(box, 'runtime.ts')).href);
  const { smokeAdapter } = await import(pathToFileURL(join(box, 'smoke-adapter.ts')).href);
  const { sha256 } = await import(pathToFileURL(join(box, 'checksum-util.ts')).href);
  const adapters = { smoke: smokeAdapter };

  // --- network-egress guard ----------------------------------------------------------
  const fetchCalls = [];
  const fetchGuard = async (url) => {
    fetchCalls.push(String(url));
    throw new Error(`SMOKE ISOLATION VIOLATION: network egress attempted to ${url}`);
  };

  // Build a checksum-valid Prompt Package for a case (matches verifyPackageChecksum:
  // sha256 over the package minus manifest, with manifest minus {timestamp, checksum}).
  function buildPackage(caseObj) {
    const pkg = JSON.parse(JSON.stringify(caseObj.promptPackage));
    if (caseObj.injectResponse !== undefined) pkg.__smokeResponse__ = caseObj.injectResponse;
    const { manifest, ...rest } = pkg;
    const { timestamp, checksum, ...manifestBase } = manifest || {};
    pkg.manifest = { ...manifest, checksum: sha256({ ...rest, manifest: manifestBase }) };
    return pkg;
  }

  async function runCase(caseObj) {
    const runId = 'smoke-' + randomUUID();
    const pkg = buildPackage(caseObj);
    const config = { model: 'smoke-model', maxTokens: 4096, apiKey: '' };
    const netBefore = fetchCalls.length;
    const result = await executePromptPackage(pkg, caseObj.userVariables ?? {}, config, adapters, fetchGuard);
    return {
      id: caseObj.id,
      runId,
      status: result.status,
      reason: result.issues && result.issues[0] ? result.issues[0].reason : null,
      artifactFields: result.artifact && result.artifact.structuredResponse ? Object.keys(result.artifact.structuredResponse).sort() : [],
      netDuringCase: fetchCalls.length - netBefore,
    };
  }

  // --- load cases --------------------------------------------------------------------
  const cases = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readFileSync(join(CASES_DIR, f), 'utf8')));
  if (!cases.length) fail('no smoke cases found under verification/smoke/cases/.');

  // --- run the suite TWICE (repeatability, A-M2) -------------------------------------
  const pass1 = [];
  for (const c of cases) pass1.push(await runCase(c));
  const pass2 = [];
  for (const c of cases) pass2.push(await runCase(c));

  // --- assertions --------------------------------------------------------------------
  const problems = [];
  const caseById = Object.fromEntries(cases.map((c) => [c.id, c]));
  for (const r of pass1) {
    const exp = caseById[r.id].expect || {};
    if (exp.status && r.status !== exp.status) problems.push(`${r.id}: expected status "${exp.status}" but got "${r.status}"`);
    if (exp.reason && r.reason !== exp.reason) problems.push(`${r.id}: expected reason "${exp.reason}" but got "${r.reason}"`);
    if (r.netDuringCase !== 0) problems.push(`${r.id}: ${r.netDuringCase} network call(s) during execution (must be 0)`);
  }
  // repeatability: same result SHAPE across the two passes (ignore run_id/timestamps)
  const shape = (r) => JSON.stringify({ id: r.id, status: r.status, reason: r.reason, artifactFields: r.artifactFields });
  for (let i = 0; i < pass1.length; i++) {
    if (shape(pass1[i]) !== shape(pass2[i])) problems.push(`${pass1[i].id}: result shape differs between run 1 and run 2 (not repeatable)`);
  }
  if (fetchCalls.length !== 0) problems.push(`total network egress across suite: ${fetchCalls.length} (must be 0) — [${fetchCalls.join(', ')}]`);

  // --- report ------------------------------------------------------------------------
  const report = {
    gate: 'CP-4 / verify:smoke',
    ok: problems.length === 0,
    isolation: {
      productionTablesWritten: false,
      evidence: {
        runtime_is_pure_value_in_value_out: true,
        db_persistence_markers_in_runtime_logic: dbHits,           // [] == none
        network_egress_calls: fetchCalls.length,                    // 0
        executed_logic_sha256: logicHashes,                         // proves which bytes ran
      },
    },
    cases: pass1.map((r) => ({ id: r.id, run_id: r.runId, status: r.status, reason: r.reason, artifact_fields: r.artifactFields, net_calls: r.netDuringCase })),
    repeated: true,
    problems,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`verify:smoke — ${cases.length} case(s), run twice`);
    console.log(`  isolation: db-markers-in-runtime=[${dbHits.join(', ') || 'none'}]  network-egress=${fetchCalls.length}  prod-tables-written=NO`);
    for (const r of pass1) console.log(`  ${problems.some((p) => p.startsWith(r.id + ':')) ? 'FAIL' : 'OK  '} ${r.id.padEnd(16)} status=${r.status.padEnd(9)} reason=${r.reason ?? '-'}  run_id=${r.runId}  net=${r.netDuringCase}`);
    console.log('  executed runtime logic sha256:');
    for (const f of LOGIC_FILES) console.log(`    ${logicHashes[f].slice(0, 16)}  ${f}`);
  }

  if (problems.length) { for (const p of problems) console.error('  ! ' + p); fail('smoke assertions failed.'); }
  if (!JSON_OUT) console.log('verify:smoke PASS — one complete execution per case, isolated run_id, zero production-table writes, zero network egress.');
  process.exit(0);
} finally {
  rmSync(box, { recursive: true, force: true });
}
