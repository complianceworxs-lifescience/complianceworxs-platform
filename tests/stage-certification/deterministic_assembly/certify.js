// M7-03 per-stage certification entrypoint for the "deterministic_assembly" stage.
// Run: node --experimental-strip-types tests/stage-certification/deterministic_assembly/certify.js
import { runStageCLI } from '../_lib/certify-core.mjs';
runStageCLI('deterministic_assembly');
