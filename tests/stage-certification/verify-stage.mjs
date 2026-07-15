// M7-03 single-command stage-certification runner.
//   node --experimental-strip-types tests/stage-certification/verify-stage.mjs <stage_name|#|all>
// (The npm `verify:stage` script wiring is step 6 / M7-12; this is the runnable entrypoint
// the CP-3 gate uses now.)
import { runStageCLI, certifyStage } from './_lib/certify-core.mjs';
import { STAGES } from './_lib/stages.mjs';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: verify-stage <stage_name | stage_number | all>');
  process.exit(2);
}

function resolveName(a) {
  if (STAGES[a]) return a;
  const n = Number(a);
  if (!Number.isNaN(n)) return Object.keys(STAGES).find((k) => STAGES[k].n === n) || null;
  return null;
}

if (arg === 'all') {
  let allOk = true;
  for (const name of Object.keys(STAGES)) {
    const r = certifyStage(name);
    if (!r.ok) allOk = false;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  #${String(r.n).padStart(2)} ${name.padEnd(24)} (${r.count} cases, ${r.kind})`);
    if (!r.ok) for (const e of r.errors) console.error('       ! ' + e);
  }
  console.log(allOk ? `\nverify:stage all PASS — ${Object.keys(STAGES).length}/${Object.keys(STAGES).length} stages certified.` : '\nverify:stage all FAIL');
  process.exit(allOk ? 0 : 1);
} else {
  const name = resolveName(arg);
  if (!name) {
    console.error(`unknown stage: ${arg}`);
    process.exit(2);
  }
  runStageCLI(name);
}
