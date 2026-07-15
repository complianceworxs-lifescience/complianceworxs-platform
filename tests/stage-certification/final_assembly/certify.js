// M7-03 per-stage certification entrypoint for the "final_assembly" stage.
// Run: node --experimental-strip-types tests/stage-certification/final_assembly/certify.js
import { runStageCLI } from '../_lib/certify-core.mjs';
runStageCLI('final_assembly');
