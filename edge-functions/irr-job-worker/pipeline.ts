import { IrrRequest, PipelineResult } from './types.ts';
import { buildIrrContract } from './contract-builder.ts';
import { buildCompletedResponse } from './response-builder.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const FAST_TIMEOUT_MS = 8000;
const GENERATION_DEADLINE_MS = 360_000;

async function callJson(url: string, body: unknown, fetchImpl: typeof fetch, timeoutMs: number): Promise<{ status: number; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch (e) { throw new Error(`Upstream ${url} returned invalid JSON (status=${res.status}): ${(e as Error).message}; body=${text.slice(0, 500)}`); }
    return { status: res.status, body: json };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`Upstream ${url} timed out after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function parseModelOutput(textContent: string): { parsed: Record<string, unknown> | null; parseError: string | null } {
  const fenceStripped = textContent.replace(/```json|```/g, '').trim();
  const firstBrace = fenceStripped.indexOf('{');
  const lastBrace = fenceStripped.lastIndexOf('}');
  const clean = firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace ? fenceStripped.slice(firstBrace, lastBrace + 1) : fenceStripped;
  try {
    const parsed = JSON.parse(clean);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { parsed: null, parseError: 'Parsed value is not a JSON object.' };
    return { parsed, parseError: null };
  } catch (err) {
    return { parsed: null, parseError: `Model output was not valid JSON: ${(err as Error).message}` };
  }
}

function validateAgainstOutputSchema(parsed: Record<string, unknown> | null, schema: any) {
  if (!parsed) return { valid: false, missingFields: [...schema.required], typeMismatches: [] };
  const missingFields: string[] = [];
  const typeMismatches: string[] = [];
  for (const field of schema.required) {
    if (!(field in parsed)) { missingFields.push(field); continue; }
    const expectedType = schema.properties[field]?.type;
    const value = parsed[field];
    const actualIsArray = Array.isArray(value);
    if (expectedType === 'array' && !actualIsArray) typeMismatches.push(field);
    if (expectedType === 'string' && (actualIsArray || typeof value !== 'string')) typeMismatches.push(field);
  }
  return { valid: missingFields.length === 0 && typeMismatches.length === 0, missingFields, typeMismatches };
}

async function callAnthropic(promptPackage: any, filledUserPrompt: string, maxTokens: number, fetchImpl: typeof fetch): Promise
  | { ok: true; textContent: string; model: string; tokens: { input: number | null; output: number | null }; latencyMs: number }
  | { ok: false; reason: 'generation_timeout' | 'network_error' | 'api_error'; message: string; latencyMs: number }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION_DEADLINE_MS);
  const start = Date.now();
  try {
    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: maxTokens, system: promptPackage.promptSpecification.systemPrompt, messages: [{ role: 'user', content: filledUserPrompt }] }),
      signal: controller.signal,
    });
    const data = await response.json();
    const latencyMs = Date.now() - start;
    if (data.error) return { ok: false, reason: 'api_error', message: data.error.message ?? 'Claude API error', latencyMs };
    return { ok: true, textContent: data?.content?.[0]?.text ?? '', model: data?.model ?? 'claude-sonnet-4-5', tokens: { input: data?.usage?.input_tokens ?? null, output: data?.usage?.output_tokens ?? null }, latencyMs };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const isTimeout = err?.name === 'AbortError';
    return { ok: false, reason: isTimeout ? 'generation_timeout' : 'network_error', message: isTimeout ? `Generation exceeded its ${GENERATION_DEADLINE_MS}ms deadline and was explicitly aborted -- classified as a timeout, not lost.` : `Runtime adapter call failed: ${err.message}`, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

export async function runIrrPipeline(input: IrrRequest, fetchImpl: typeof fetch): Promise<PipelineResult> {
  const validateUrl = `${SUPABASE_URL}/functions/v1/validate-editorial-contract`;
  const compileContractUrl = `${SUPABASE_URL}/functions/v1/compile-editorial-contract`;
  const compilePromptUrl = `${SUPABASE_URL}/functions/v1/compile-prompt-specification`;
  const validateOutputUrl = `${SUPABASE_URL}/functions/v1/validate-editorial-output`;

  const contract = buildIrrContract(input);

  const validation = await callJson(validateUrl, contract, fetchImpl, FAST_TIMEOUT_MS);
  if (validation.body.status !== 'valid') {
    return { status: 'rejected', stage: 'contract_invalid', issues: (validation.body.issues ?? []).map((i: any) => ({ field: i.field, message: i.message })) };
  }

  const compiled = await callJson(compileContractUrl, contract, fetchImpl, FAST_TIMEOUT_MS);
  if (compiled.body.status !== 'compiled') {
    return { status: 'rejected', stage: 'execution_compile_failed', issues: (compiled.body.issues ?? []).map((i: any) => ({ field: i.field, message: i.message })) };
  }
  const executionSpecification = compiled.body.executionSpecification;

  const promptResult = await callJson(compilePromptUrl, { executionSpecification, targetRuntime: 'claude' }, fetchImpl, FAST_TIMEOUT_MS);
  if (promptResult.body.status !== 'compiled') {
    return { status: 'rejected', stage: 'prompt_package_invalid', issues: (promptResult.body.issues ?? []).map((i: any) => ({ field: i.field, message: i.message })) };
  }
  const promptPackage = promptResult.body.promptPackage;

  let filledUserPrompt = promptPackage.promptSpecification.userPromptTemplate;
  for (const required of promptPackage.promptSpecification.contextRequirements) {
    filledUserPrompt = filledUserPrompt.split(`{{${required}}}`).join((input as any)[required] ?? '');
  }

  const genResult = await callAnthropic(promptPackage, filledUserPrompt, 16000, fetchImpl);

  if (!genResult.ok) {
    return {
      status: 'rejected',
      stage: genResult.reason === 'generation_timeout' ? 'runtime_timed_out' : 'runtime_failed',
      issues: [{ field: 'runtime', message: genResult.message }],
    };
  }

  const { parsed, parseError } = parseModelOutput(genResult.textContent);
  if (parseError || !parsed) {
    return { status: 'rejected', stage: 'invalid_json_output', issues: [{ field: 'runtime', message: parseError ?? 'No parsed output.' }] };
  }

  const schemaResult = validateAgainstOutputSchema(parsed, promptPackage.outputSchema);
  if (!schemaResult.valid) {
    return { status: 'rejected', stage: 'invalid_response_schema', issues: [{ field: 'runtime', message: `Missing: [${schemaResult.missingFields.join(', ')}]. Type mismatches: [${schemaResult.typeMismatches.join(', ')}].` }] };
  }

  const runtimeManifest = {
    runtimeVersion: '2.1.0',
    runtimeAdapter: 'claude-inprocess-waituntil',
    model: genResult.model,
    latencyMs: genResult.latencyMs,
    tokens: genResult.tokens,
    schemaValidation: 'passed',
    packageChecksum: promptPackage.manifest.checksum,
  };

  const validationResult = await callJson(validateOutputUrl, { artifact: { structuredResponse: parsed }, executionSpecification, promptPackage, runtimeManifest, skipEditorialReview: true }, fetchImpl, FAST_TIMEOUT_MS);
  const terminalState = validationResult.body.terminalState;

  if (terminalState !== 'PASS') {
    return {
      status: 'rejected',
      stage: 'structural_validation_failed',
      terminalState: terminalState ?? 'REJECT',
      issues: (validationResult.body.blockingReasons ?? validationResult.body.deterministic?.checks?.filter((c: any) => c.result === 'fail').map((c: any) => c.detail ?? c.description) ?? ['Validation service returned no terminal state -- treated as REJECT.']).map((m: string) => ({ field: 'validation', message: m })),
    };
  }

  return buildCompletedResponse({
    contractId: contract.contractId,
    decisionOwner: input.decisionOwner,
    authorizationDate: input.authorizationDate,
    industry: input.industry,
    artifact: { structuredResponse: parsed },
    executionSpecification,
    promptPackage,
    runtimeManifest,
    editorialReview: validationResult.body.editorialReview,
    reviewError: validationResult.body.reviewError,
    validationManifestChecksum: validationResult.body.manifest.checksum,
  });
}