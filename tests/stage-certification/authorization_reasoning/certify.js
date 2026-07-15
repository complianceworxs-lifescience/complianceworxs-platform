// M7-03 per-stage certification entrypoint for the "authorization_reasoning" stage.
// Run: node --experimental-strip-types tests/stage-certification/authorization_reasoning/certify.js
import { runStageCLI } from '../_lib/certify-core.mjs';
runStageCLI('authorization_reasoning');
