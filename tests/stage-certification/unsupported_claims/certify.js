// M7-03 per-stage certification entrypoint for the "unsupported_claims" stage.
// Run: node --experimental-strip-types tests/stage-certification/unsupported_claims/certify.js
import { runStageCLI } from '../_lib/certify-core.mjs';
runStageCLI('unsupported_claims');
