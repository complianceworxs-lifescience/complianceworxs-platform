// M7-03 per-stage certification entrypoint for the "remediation_scaffold" stage.
// Run: node --experimental-strip-types tests/stage-certification/remediation_scaffold/certify.js
import { runStageCLI } from '../_lib/certify-core.mjs';
runStageCLI('remediation_scaffold');
