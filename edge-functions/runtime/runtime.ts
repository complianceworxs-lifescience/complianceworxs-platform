import { PromptPackage } from './prompt-schema.ts';
import { RuntimeAdapter } from './adapter.ts';
import { RuntimeConfiguration, RuntimeResult, RuntimeIssue, ExecutionLogEntry } from './types.ts';
import { sha256 } from './checksum-util.ts';
import { parseModelOutput } from './response-parser.ts';
import { validateAgainstOutputSchema } from './schema-validator.ts';
import { buildRuntimeManifest } from './runtime-manifest.ts';

const EXPECTED_PROMPT_COMPILER_VERSION = '1.0.0';

// A truncated/incomplete model response produces a JSON parse failure that is
// NOT the same defect class as a schema violation (missing/extra/wrong-type
// field on otherwise-valid JSON). Truncation is often transient -- a single
// retry is cheap and resolves it most of the time. Bounded to 1 retry so a
// persistently malformed output still fails fast and cleanly rather than
// looping.
const MAX_JSON_PARSE_RETRIES = 1;

function log(entries: ExecutionLogEntry[], step: string, detail: string) {
  entries.push({ step, timestamp: new Date().toISOString(), detail });
}

function verifyPackageChecksum(pkg: PromptPackage): boolean {
  const { manifest, ...packageWithoutManifest } = pkg;
  const { timestamp, checksum, ...manifestBase } = manifest;
  const recomputed = sha256({ ...packageWithoutManifest, manifest: manifestBase });
  return recomputed === checksum;
}

function verifyManifestFields(pkg: PromptPackage): RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];
  if (pkg.manifest.promptCompilerVersion !== EXPECTED_PROMPT_COMPILER_VERSION) {
    issues.push({ reason: 'manifest_invalid', field: 'manifest.promptCompilerVersion', message: `Prompt Package was compiled by compiler ${pkg.manifest.promptCompilerVersion}, but this runtime expects ${EXPECTED_PROMPT_COMPILER_VERSION}.` });
  }
  return issues;
}

function buildRuntimeContext(pkg: PromptPackage, userVariables: Record<string, string>): { filledUserPrompt: string; issues: RuntimeIssue[] } {
  const issues: RuntimeIssue[] = [];
  let filled = pkg.promptSpecification.userPromptTemplate;
  for (const required of pkg.promptSpecification.contextRequirements) {
    if (!(required in userVariables)) {
      issues.push({ reason: 'missing_context_variable', field: required, message: `Required context variable "${required}" was not supplied.` });
      continue;
    }
    filled = filled.split(`{{${required}}}`).join(userVariables[required]);
  }
  return { filledUserPrompt: filled, issues };
}

export async function executePromptPackage(
  pkg: PromptPackage,
  userVariables: Record<string, string>,
  config: RuntimeConfiguration,
  adapters: Record<string, RuntimeAdapter>,
  fetchImpl: typeof fetch,
): Promise<RuntimeResult> {
  const executionLog: ExecutionLogEntry[] = [];
  log(executionLog, 'ART-001', 'Verifying Prompt Package checksum.');

  if (!verifyPackageChecksum(pkg)) {
    return { status: 'failed', issues: [{ reason: 'checksum_invalid', field: 'manifest.checksum', message: 'Recomputed Prompt Package checksum does not match the declared checksum.' }], executionLog };
  }

  log(executionLog, 'ART-002', 'Verifying manifest fields.');
  const manifestIssues = verifyManifestFields(pkg);
  if (manifestIssues.length > 0) return { status: 'failed', issues: manifestIssues, executionLog };

  log(executionLog, 'ART-003', 'Building runtime context.');
  const { filledUserPrompt, issues: contextIssues } = buildRuntimeContext(pkg, userVariables);
  if (contextIssues.length > 0) return { status: 'failed', issues: contextIssues, executionLog };

  log(executionLog, 'ART-004', 'Execution request assembled.');

  const adapter = adapters[pkg.promptSpecification.targetRuntime];
  if (!adapter) {
    return { status: 'failed', issues: [{ reason: 'unsupported_runtime', field: 'targetRuntime', message: `No adapter registered for runtime "${pkg.promptSpecification.targetRuntime}".` }], executionLog };
  }

  let attempt = 0;
  let adapterResponse: Awaited<ReturnType<typeof adapter.execute>> | undefined;
  let executionStart = new Date().toISOString();
  let executionEnd = '';
  let parsed: Record<string, unknown> | null = null;
  let parseError: string | null = null;

  while (attempt <= MAX_JSON_PARSE_RETRIES) {
    executionStart = new Date().toISOString();
    log(executionLog, 'ART-005', `Invoking ${adapter.name} adapter (attempt ${attempt + 1} of ${MAX_JSON_PARSE_RETRIES + 1}).`);

    try {
      adapterResponse = await adapter.execute(pkg, filledUserPrompt, config, fetchImpl);
    } catch (err) {
      executionEnd = new Date().toISOString();
      const runtimeManifest = buildRuntimeManifest({ runtimeAdapter: adapter.name, model: config.model, executionStart, executionEnd, tokens: { input: null, output: null }, schemaValidation: 'failed', packageChecksum: pkg.manifest.checksum });
      log(executionLog, 'ART-006', `Adapter execution failed: ${(err as Error).message}`);
      return { status: 'failed', issues: [{ reason: 'network_error', message: `Runtime adapter call failed: ${(err as Error).message}` }], executionLog, runtimeManifest };
    }

    executionEnd = new Date().toISOString();
    log(executionLog, 'ART-006', 'Response captured.');

    const parseResult = parseModelOutput(adapterResponse.textContent);
    parsed = parseResult.parsed;
    parseError = parseResult.parseError;

    if (!parseError) break;

    log(executionLog, 'ART-007', `Parse failed on attempt ${attempt + 1}: ${parseError}`);
    attempt++;
  }

  if (parseError || !adapterResponse) {
    // Exhausted retries on malformed/truncated JSON. Classified distinctly
    // from a schema violation (invalid_response_schema) -- this is a parse
    // failure, the model never produced structurally valid JSON to validate.
    const runtimeManifest = buildRuntimeManifest({ runtimeAdapter: adapter.name, model: adapterResponse?.model ?? config.model, executionStart, executionEnd, tokens: adapterResponse?.tokens ?? { input: null, output: null }, schemaValidation: 'failed', packageChecksum: pkg.manifest.checksum });
    return { status: 'failed', issues: [{ reason: 'invalid_json_output', message: `Model output was not valid JSON after ${attempt + 1} attempt(s): ${parseError ?? 'no response captured'}.` }], executionLog, runtimeManifest };
  }

  log(executionLog, 'ART-007', 'Response parsed, validating against output schema.');

  const schemaResult = validateAgainstOutputSchema(parsed, pkg.outputSchema);

  const runtimeManifest = buildRuntimeManifest({ runtimeAdapter: adapter.name, model: adapterResponse.model, executionStart, executionEnd, tokens: adapterResponse.tokens, schemaValidation: schemaResult.valid ? 'passed' : 'failed', packageChecksum: pkg.manifest.checksum });

  if (!schemaResult.valid) {
    log(executionLog, 'ART-007', `Schema validation failed. Missing: [${schemaResult.missingFields.join(', ')}]. Type mismatches: [${schemaResult.typeMismatches.join(', ')}]. Unexpected fields: [${schemaResult.unexpectedFields.join(', ')}].`);
    return { status: 'failed', issues: [{ reason: 'invalid_response_schema', message: `Response did not match required output schema. Missing: [${schemaResult.missingFields.join(', ')}]. Type mismatches: [${schemaResult.typeMismatches.join(', ')}]. Unexpected fields not permitted by contract: [${schemaResult.unexpectedFields.join(', ')}].` }], executionLog, runtimeManifest };
  }

  log(executionLog, 'ART-008', 'Runtime Manifest produced.');
  return { status: 'executed', artifact: { structuredResponse: parsed as Record<string, unknown>, rawResponse: adapterResponse.rawResponse }, runtimeManifest, executionLog };
}
