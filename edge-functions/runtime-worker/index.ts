import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const INTERNAL_DEADLINE_MS = 260_000;
const WORKER_DEADLINE_MS = 390_000;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function headers(): Record<string, string> {
  return { 'Content-Type': 'application/json', apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, Prefer: 'return=representation' };
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
  if (!parsed) return { valid: false, missingFields: [...(schema?.required ?? [])], typeMismatches: [] };
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

interface Row {
  generation_id: string;
  prompt_package: any;
  filled_user_prompt: string;
  max_tokens: number | null;
  attempt_count: number;
  max_attempts: number;
}

async function patchRow(generationId: string, patch: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/runtime_generations?generation_id=eq.${generationId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Failed to patch runtime_generations ${generationId} (status ${res.status}): ${text.slice(0, 500)}`);
  }
}

async function requeueForRetry(generationId: string, attemptCount: number, issue: Record<string, unknown>) {
  await patchRow(generationId, {
    claimed_at: null,
    attempt_count: attemptCount + 1,
    issues: [{ ...issue, retried: true, retry_attempt: attemptCount + 1 }],
  });
}

const RETRYABLE_REASONS = new Set(['invalid_json_output', 'invalid_response_schema']);

async function runGeneration(row: Row) {
  const executionStart = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTERNAL_DEADLINE_MS);

  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: row.max_tokens ?? 16000,
        system: row.prompt_package.promptSpecification.systemPrompt,
        messages: [{ role: 'user', content: row.filled_user_prompt }],
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    const isTimeout = err?.name === 'AbortError';
    await patchRow(row.generation_id, {
      status: 'failed',
      claimed_at: null,
      issues: [{
        reason: isTimeout ? 'generation_timeout' : 'network_error',
        message: isTimeout
          ? `Generation exceeded its ${INTERNAL_DEADLINE_MS}ms internal deadline and was explicitly aborted -- classified as a timeout, not lost.`
          : `Runtime adapter call failed: ${err.message}`,
      }],
    });
    return;
  }
  clearTimeout(timer);
  const executionEnd = new Date().toISOString();

  const data = await response.json();
  if (data.error) {
    await patchRow(row.generation_id, { status: 'failed', claimed_at: null, issues: [{ reason: 'api_error', message: data.error.message ?? 'Claude API error' }] });
    return;
  }

  const textContent = data?.content?.[0]?.text ?? '';
  const { parsed, parseError } = parseModelOutput(textContent);
  const schemaResult = validateAgainstOutputSchema(parsed, row.prompt_package.outputSchema);

  const runtimeManifest = {
    runtimeVersion: '1.1.0',
    runtimeAdapter: 'claude-supabase-worker',
    model: data?.model ?? 'claude-sonnet-4-5',
    executionStart,
    executionEnd,
    latencyMs: new Date(executionEnd).getTime() - new Date(executionStart).getTime(),
    tokens: { input: data?.usage?.input_tokens ?? null, output: data?.usage?.output_tokens ?? null },
    schemaValidation: schemaResult.valid ? 'passed' : 'failed',
    packageChecksum: row.prompt_package.manifest.checksum,
  };

  if (!schemaResult.valid) {
    const reason = parseError ? 'invalid_json_output' : 'invalid_response_schema';
    const issue = {
      reason,
      message: parseError ?? `Response did not match required output schema. Missing: [${schemaResult.missingFields.join(', ')}]. Type mismatches: [${schemaResult.typeMismatches.join(', ')}].`,
    };

    if (RETRYABLE_REASONS.has(reason) && row.attempt_count + 1 < row.max_attempts) {
      await requeueForRetry(row.generation_id, row.attempt_count, issue);
      return;
    }

    await patchRow(row.generation_id, { status: 'failed', claimed_at: null, issues: [{ ...issue, exhaustedRetries: row.attempt_count + 1 }], runtime_manifest: runtimeManifest });
    return;
  }

  await patchRow(row.generation_id, {
    status: 'completed',
    claimed_at: null,
    artifact: { structuredResponse: parsed, rawResponse: data },
    runtime_manifest: runtimeManifest,
  });
}

async function reclaimOverdue(): Promise<number> {
  const nowIso = new Date().toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/runtime_generations?status=eq.pending&claimed_at=not.is.null&expires_at=lt.${nowIso}`,
    {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({
        status: 'timed_out',
        claimed_at: null,
        issues: [{ reason: 'timed_out', message: 'Job exceeded its worker deadline and was never marked terminal -- the worker was almost certainly recycled or killed mid-generation. Reclaimed deterministically rather than left abandoned.' }],
        updated_at: nowIso,
      }),
    },
  );
  if (!res.ok) { const text = await res.text(); console.error(`reclaimOverdue failed (status ${res.status}): ${text.slice(0, 500)}`); return 0; }
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}

async function claimNext(): Promise<Row | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_next_runtime_generation`, { method: 'POST', headers: headers(), body: JSON.stringify({}) });
  if (!res.ok) { const text = await res.text(); throw new Error(`claim_next_runtime_generation failed (status ${res.status}): ${text.slice(0, 500)}`); }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0] as Row;
}

serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let reclaimed = 0;
  try {
    reclaimed = await reclaimOverdue();
  } catch (err) {
    console.error(`reclaimOverdue threw: ${(err as Error).message}`);
  }

  let row: Row | null;
  try {
    row = await claimNext();
  } catch (err) {
    return jsonResponse({ status: 'error', stage: 'claim_failed', message: (err as Error).message, reclaimed }, 500);
  }

  if (!row) {
    return jsonResponse({ status: 'idle', message: 'No pending generations.', reclaimed }, 200);
  }

  // @ts-ignore -- EdgeRuntime is a Supabase/Deno Deploy global, not in std types.
  EdgeRuntime.waitUntil(runGeneration(row));

  return jsonResponse({ status: 'processing', generation_id: row.generation_id, attempt: row.attempt_count + 1, reclaimed }, 202);
});
