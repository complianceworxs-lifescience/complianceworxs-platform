// M7-14 / M7-09 — deterministic smoke adapter.
//
// Implements the same RuntimeAdapter shape as the production claude/openai adapters
// (edge-functions/runtime/claude-adapter.ts) but makes NO network call and invokes NO
// external model. It exists purely so `executePromptPackage` can run one complete
// execution end-to-end, offline and deterministically, against a fixture Prompt Package.
//
// Behaviour:
//   * If the smoke case injected a raw model response (pkg.__smokeResponse__), return it
//     verbatim — used to exercise the runtime's parse / terminal-failure classification.
//   * Otherwise synthesize a schema-valid JSON object from the package's outputSchema
//     (one value per required field, correctly typed, no extra keys), so the happy path
//     reaches a validated `executed` terminal state.
export const smokeAdapter = {
  name: 'smoke',
  async execute(pkg, _filledUserPrompt, _config, _fetchImpl) {
    const injected = pkg && pkg.__smokeResponse__;
    const text = injected !== undefined ? injected : JSON.stringify(synthesizeFromSchema(pkg.outputSchema));
    return { rawResponse: { smoke: true }, textContent: text, model: 'smoke-model', tokens: { input: 0, output: 0 } };
  },
};

function synthesizeFromSchema(schema) {
  const out = {};
  for (const field of schema.required) {
    const type = schema.properties[field] && schema.properties[field].type;
    out[field] = type === 'array' ? [] : `smoke:${field}`;
  }
  return out;
}
