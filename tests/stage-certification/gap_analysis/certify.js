// M7-03 per-stage certification entrypoint for the "gap_analysis" stage.
// Run: node --experimental-strip-types tests/stage-certification/gap_analysis/certify.js
import { runStageCLI } from '../_lib/certify-core.mjs';
runStageCLI('gap_analysis');
