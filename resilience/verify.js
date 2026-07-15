#!/usr/bin/env node
// M7A-01/02 taxonomy verification (CW-MDR-007A §16 CP-A1).
// (1) Recompiles the taxonomy into a throwaway temp dir and diffs the output BYTE-FOR-BYTE
//     against the committed resilience/generated/*. (2) Byte-verifies any deployed consumer
//     COPIES (edge-functions/*/resilience-generated.ts) against the committed artifact — so a
//     copy can never drift from source (the risk M7 solved for the contract). Exits 0 iff
//     everything is byte-identical; nonzero on any drift, missing/extra file, or compile failure.
//
// Usage:
//   node verify.js                                  # verify committed taxonomy.yaml/policy.yaml
//   node verify.js --taxonomy <p> [--policy <p>]    # verify a candidate (negative test)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const COMMITTED = path.join(HERE, 'generated');
const COMPILE = path.join(HERE, 'compile.js');
const REPO = path.resolve(HERE, '..');

// Consumer copies to verify once they exist (created in build step 3). Absent = fine for now.
const CONSUMER_COPIES = [
  path.join(REPO, 'edge-functions', 'irr-stage-engine', 'resilience-generated.ts'),
  path.join(REPO, 'edge-functions', 'irr-job-worker', 'resilience-generated.ts'),
];

function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function fail(msg) { console.error('verify:taxonomy FAIL — ' + msg); process.exit(1); }
const argVal = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };

let taxonomyPath = path.join(HERE, 'taxonomy.yaml');
let policyPath = path.join(HERE, 'policy.yaml');
if (argVal('--taxonomy')) taxonomyPath = path.resolve(argVal('--taxonomy'));
if (argVal('--policy')) policyPath = path.resolve(argVal('--policy'));

if (!fs.existsSync(COMMITTED)) fail('committed resilience/generated/ is missing (no diff target).');
if (!fs.existsSync(COMPILE)) fail('resilience/compile.js is missing.');
for (const p of [taxonomyPath, policyPath]) if (!fs.existsSync(p)) fail('source not found: ' + p);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-verify-tax-'));
try {
  fs.copyFileSync(COMPILE, path.join(tmp, 'compile.js'));
  fs.copyFileSync(taxonomyPath, path.join(tmp, 'taxonomy.yaml'));
  fs.copyFileSync(policyPath, path.join(tmp, 'policy.yaml'));
  try {
    execFileSync(process.execPath, [path.join(tmp, 'compile.js')], {
      env: { ...process.env, NODE_PATH: path.join(HERE, 'node_modules') },
      stdio: 'pipe',
    });
  } catch (e) {
    fail('taxonomy did not compile cleanly: ' + (e.stderr ? e.stderr.toString().trim() : e.message));
  }

  const tmpGen = path.join(tmp, 'generated');
  const committedFiles = fs.readdirSync(COMMITTED).sort();
  const freshFiles = fs.existsSync(tmpGen) ? fs.readdirSync(tmpGen).sort() : [];
  const allNames = [...new Set([...committedFiles, ...freshFiles])].sort();

  let ok = true;
  console.log('verify:taxonomy — source: ' + taxonomyPath);
  for (const name of allNames) {
    const cf = path.join(COMMITTED, name), ff = path.join(tmpGen, name);
    const cEx = fs.existsSync(cf), fEx = fs.existsSync(ff);
    if (!cEx || !fEx) { ok = false; console.log('  DIFF ' + name + ' (' + (!cEx ? 'extra from compile' : 'committed not regenerated') + ')'); continue; }
    const cb = fs.readFileSync(cf), fb = fs.readFileSync(ff);
    const match = Buffer.compare(cb, fb) === 0;
    if (!match) ok = false;
    console.log('  ' + (match ? 'OK   ' : 'DIFF ') + name + '  ' + (match ? 'committed=' + sha(cb).slice(0, 16) : 'committed=' + sha(cb).slice(0, 16) + ' fresh=' + sha(fb).slice(0, 16)));
  }
  if (!ok) fail('generated artifacts drift from committed resilience/generated/.');

  // consumer copy verification (byte-identical to the committed artifact)
  const genArtifact = fs.readFileSync(path.join(COMMITTED, 'resilience-generated.ts'));
  const genSha = sha(genArtifact);
  let copies = 0;
  for (const cp of CONSUMER_COPIES) {
    if (!fs.existsSync(cp)) { console.log('  --   ' + path.relative(REPO, cp) + ' (no copy yet — pre-step-3)'); continue; }
    copies++;
    const match = sha(fs.readFileSync(cp)) === genSha;
    if (!match) ok = false;
    console.log('  ' + (match ? 'OK   ' : 'DIFF ') + path.relative(REPO, cp) + ' (consumer copy)');
  }
  if (!ok) fail('a consumer copy drifts from resilience/generated/resilience-generated.ts.');

  console.log(`verify:taxonomy PASS — ${allNames.length} generated artifacts byte-identical; ${copies} consumer cop(y|ies) verified.`);
  process.exit(0);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
