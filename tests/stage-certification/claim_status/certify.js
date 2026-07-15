// M7-03 per-stage certification entrypoint for the "claim_status" stage.
// Run: node --experimental-strip-types tests/stage-certification/claim_status/certify.js
import { runStageCLI } from '../_lib/certify-core.mjs';
runStageCLI('claim_status');
