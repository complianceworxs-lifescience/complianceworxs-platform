// M7-03 per-stage certification entrypoint for the "validate_contract" stage.
// Run: node --experimental-strip-types tests/stage-certification/validate_contract/certify.js
import { runStageCLI } from '../_lib/certify-core.mjs';
runStageCLI('validate_contract');
