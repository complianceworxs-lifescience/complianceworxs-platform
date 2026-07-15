// M7-03 per-stage certification entrypoint for the "compile_prompt_spec" stage.
// Run: node --experimental-strip-types tests/stage-certification/compile_prompt_spec/certify.js
import { runStageCLI } from '../_lib/certify-core.mjs';
runStageCLI('compile_prompt_spec');
