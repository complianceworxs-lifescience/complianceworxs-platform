#!/usr/bin/env node
// M7-02 compiler verification (CW-MDR-007 §7, CP-1 / T-1).
// Recompiles the contract into a throwaway temp dir and diffs the output BYTE-FOR-BYTE
// against the committed compiler/generated/*. Exits 0 iff every generated artifact is
// byte-identical; exits nonzero (1) on any drift, missing/extra file, or compile failure.
//
// Usage:
//   node verify.js                      # verify the committed compiler/contract.yaml
//   node verify.js --contract <path>    # verify a candidate/other contract (used by the
//                                       # negative test: a corrupted copy must fail)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const COMMITTED = path.join(HERE, 'generated');
const COMPILE = path.join(HERE, 'compile.js');

function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function fail(msg) { console.error('verify:compiler FAIL — ' + msg); process.exit(1); }

// --- resolve which contract to verify ---
let contractPath = path.join(HERE, 'contract.yaml');
const ci = process.argv.indexOf('--contract');
if (ci !== -1 && process.argv[ci + 1]) contractPath = path.resolve(process.argv[ci + 1]);

if (!fs.existsSync(COMMITTED)) fail('committed compiler/generated/ is missing (no diff target).');
if (!fs.existsSync(COMPILE)) fail('compiler/compile.js is missing.');
if (!fs.existsSync(contractPath)) fail('contract not found: ' + contractPath);

// --- recompile into a temp dir (compile.js writes to <its dir>/generated) ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-verify-'));
try {
  fs.copyFileSync(COMPILE, path.join(tmp, 'compile.js'));
  fs.copyFileSync(contractPath, path.join(tmp, 'contract.yaml'));
  try {
    // NODE_PATH lets require('js-yaml') resolve to compiler/node_modules from the temp copy.
    execFileSync(process.execPath, [path.join(tmp, 'compile.js')], {
      env: { ...process.env, NODE_PATH: path.join(HERE, 'node_modules') },
      stdio: 'pipe',
    });
  } catch (e) {
    fail('contract did not compile cleanly: ' + (e.stderr ? e.stderr.toString().trim() : e.message));
  }

  const tmpGen = path.join(tmp, 'generated');
  const committedFiles = fs.readdirSync(COMMITTED).sort();
  const freshFiles = fs.existsSync(tmpGen) ? fs.readdirSync(tmpGen).sort() : [];
  const allNames = [...new Set([...committedFiles, ...freshFiles])].sort();

  let ok = true;
  const rows = [];
  for (const name of allNames) {
    const cf = path.join(COMMITTED, name);
    const ff = path.join(tmpGen, name);
    const cEx = fs.existsSync(cf), fEx = fs.existsSync(ff);
    if (!cEx || !fEx) {
      ok = false;
      rows.push({ name, match: false, note: !cEx ? 'extra file from compile (not committed)' : 'committed file not regenerated' });
      continue;
    }
    const cb = fs.readFileSync(cf), fb = fs.readFileSync(ff);
    const match = Buffer.compare(cb, fb) === 0;
    if (!match) ok = false;
    rows.push({ name, match, committed: sha(cb).slice(0, 16), fresh: sha(fb).slice(0, 16), bytes: cb.length + '/' + fb.length });
  }

  console.log('verify:compiler — contract: ' + contractPath);
  for (const r of rows) {
    console.log('  ' + (r.match ? 'OK   ' : 'DIFF ') + r.name + '  ' +
      (r.note ? '(' + r.note + ')' : 'committed=' + r.committed + ' fresh=' + r.fresh + ' bytes(c/f)=' + r.bytes));
  }
  if (!ok) fail('generated artifacts drift from committed compiler/generated/.');
  console.log('verify:compiler PASS — all ' + rows.length + ' generated artifacts byte-identical to committed compiler/generated/.');
  process.exit(0);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
