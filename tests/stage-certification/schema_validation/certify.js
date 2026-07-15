// M7-03 per-stage certification entrypoint for the "schema_validation" stage.
// Run: node --experimental-strip-types tests/stage-certification/schema_validation/certify.js
import { runStageCLI } from '../_lib/certify-core.mjs';
runStageCLI('schema_validation');
