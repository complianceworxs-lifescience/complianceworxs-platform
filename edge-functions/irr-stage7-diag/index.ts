import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const STAGE6B_FIELDS = ['unsupportedClaims_list', 'inspectorChallenge_list', 'remediationScaffold_list'];

const INDUSTRY_CONTEXT: Record<string, string> = {
  pharma: 'FDA-regulated pharma/biologic/device GMP. Regs: 21 CFR 210/211, 820, ICH Q7/Q9/Q10.',
  '503b': '503B sterile compounding under cGMP + USP <797>/<71>/<85>/<800>.',
  food: 'FDA food under FSMA (21 CFR 117).',
  cosmetics: 'FDA cosmetics under MoCRA (FD&C Act 605-609).',
};

function stageContextBlock(input: any): string {
  return `Decision under review: ${input.decisionDescription}\nAudience: ${input.audience}\nEvidence summary provided: ${input.evidenceSummary}\nRisk context provided: ${input.riskContext}\nRegulatory context (${input.industry}): ${INDUSTRY_CONTEXT[input.industry] ?? ''}`;
}

function buildStageSystemPrompt(opts: { objective: string; fields: string[]; constraints: string[]; acceptanceCriteria: string[] }): string {
  const parts = [
    `You are generating one section of an Inspection Response Record (IRR). This is one stage of a multi-stage pipeline; you are NOT generating the full record, only the fields listed below.`,
    `Stage objective: ${opts.objective}`,
    `Required output fields for this stage: ${opts.fields.join(', ')}`,
  ];
  if (opts.constraints.length) parts.push(`Constraints governing these fields:\n- ${opts.constraints.join('\n- ')}`);
  if (opts.acceptanceCriteria.length) parts.push(`Acceptance criteria for these fields:\n- ${opts.acceptanceCriteria.join('\n- ')}`);
  return parts.join('\n\n');
}

async function runDiag(jobId: string, diagId: string, maxTokens: number, deadlineMs: number) {
  const runsRes = await fetch(`${SUPABASE_URL}/rest/v1/irr_stage_runs?job_id=eq.${jobId}&status=eq.completed&order=stage.asc`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const runs = await runsRes.json();
  const prior: Record<number, any> = {};
  for (const r of runs) prior[r.stage] = r.output_json;

  const jobRes = await fetch(`${SUPABASE_URL}/rest/v1/irr_jobs?job_id=eq.${jobId}&select=input_payload`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const jobRows = await jobRes.json();
  const input = jobRows[0].input_payload;

  const systemPrompt = buildStageSystemPrompt({
    objective: "Using the evidence-to-claim mapping already established, name unsupported claims, and draft inspector-facing challenge responses and remediation scaffolds.",
    fields: STAGE6B_FIELDS,
    constraints: [
      'remediationScaffold_list entries are documentation SCAFFOLDS with bracketed blanks only ([reference], [name], [date]), never finished prose with invented specifics. A signatory is a required ROLE, never an invented name.',
      'unsupportedClaims_list entries are framed as what the record fails to establish -- never as coaching on what to say or not say to an investigator.',
    ],
    acceptanceCriteria: [
      'inspectorChallenge_list grounds every response in the record -- never asserts a fact not present in the inputs.',
    ],
  });
  const userPrompt = `${stageContextBlock(input)}\n\nEstablished rationale/gaps:\n${JSON.stringify(prior[5].fields)}\n\nEstablished evidence-to-claim mapping from the prior stage (already finalized -- build on it, do not restate or contradict it):\n${JSON.stringify(prior[6].fields)}\n\nOutput ONLY a JSON object with exactly these keys: ${STAGE6B_FIELDS.join(', ')}. Do not include any other keys. No prose outside the JSON.`;

  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  let data: any;
  let aborted = false;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
      signal: controller.signal,
    });
    data = await res.json();
  } catch (e) {
    aborted = (e as Error).name === 'AbortError';
    data = { error: { message: (e as Error).message } };
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = Date.now() - t0;
  const rawText = data?.content?.[0]?.text ?? '';

  let parsed: any = null;
  let parseError: string | null = null;
  try {
    const stripped = rawText.replace(/```json|```/g, '').trim();
    const first = stripped.indexOf('{');
    const last = stripped.lastIndexOf('}');
    parsed = JSON.parse(stripped.slice(first, last + 1));
  } catch (e) {
    parseError = (e as Error).message;
  }

  const fieldMeasurements: Record<string, any> = {};
  if (parsed) {
    for (const field of STAGE6B_FIELDS) {
      const value = parsed[field];
      fieldMeasurements[field] = {
        arrayLength: Array.isArray(value) ? value.length : null,
        charCount: JSON.stringify(value ?? null).length,
      };
    }
  }

  const rawFieldProgress: Record<string, any> = {};
  for (const field of STAGE6B_FIELDS) {
    const marker = `"${field}"`;
    const idx = rawText.indexOf(marker);
    if (idx === -1) { rawFieldProgress[field] = { present: false }; continue; }
    const nextFieldIdxs = STAGE6B_FIELDS.filter((f) => f !== field).map((f) => rawText.indexOf(`"${f}"`, idx + marker.length)).filter((i) => i !== -1);
    const endIdx = nextFieldIdxs.length ? Math.min(...nextFieldIdxs) : rawText.length;
    const segment = rawText.slice(idx, endIdx);
    const completeObjectCount = (segment.match(/\}\s*,\s*\{/g) || []).length + (segment.includes('{') ? 1 : 0);
    rawFieldProgress[field] = { present: true, segmentCharCount: segment.length, approxCompleteItems: completeObjectCount };
  }

  const upstreamCounts = {
    stage5_gapFlags_list: prior[5]?.fields?.gapFlags_list?.length ?? null,
    stage5_criticalGapsRanked_list: prior[5]?.fields?.criticalGapsRanked_list?.length ?? null,
    stage6_claimStatus_list: prior[6]?.fields?.claimStatus_list?.length ?? null,
    stage6_evidenceMatrix_list: prior[6]?.fields?.evidenceMatrix_list?.length ?? null,
    stage6_evidenceTraceability_list: prior[6]?.fields?.evidenceTraceability_list?.length ?? null,
    stage6_mapReduceMeta: prior[6]?.fields?.mapReduceMeta ?? null,
  };

  const totalCharCount = rawText.length;
  const dominantField = parsed
    ? Object.entries(fieldMeasurements).sort((a: any, b: any) => b[1].charCount - a[1].charCount)[0]
    : null;

  const result = {
    maxTokensUsed: maxTokens,
    deadlineMs,
    aborted,
    latencyMs,
    completionTokens: data?.usage?.output_tokens ?? null,
    inputTokens: data?.usage?.input_tokens ?? null,
    stopReason: data?.stop_reason ?? null,
    totalCharCount,
    parseSucceeded: !!parsed,
    parseError,
    fieldMeasurements,
    rawFieldProgress,
    dominantField: dominantField ? { field: dominantField[0], charCount: dominantField[1].charCount, arrayLength: dominantField[1].arrayLength } : null,
    upstreamCounts,
    rawTextFull: rawText,
  };

  await fetch(`${SUPABASE_URL}/rest/v1/stage7_diag_results?id=eq.${diagId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ status: 'done', result }),
  });
}

serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  const jobId = body.jobId ?? 'e5432361-99ee-4731-bd31-2202eb67c2ab';
  const maxTokens = body.maxTokens ?? 2600;
  const deadlineMs = body.deadlineMs ?? 120_000;

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/stage7_diag_results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, Prefer: 'return=representation' },
    body: JSON.stringify([{ job_id: jobId, status: 'running' }]),
  });
  const inserted = await insertRes.json();
  const diagId = inserted[0].id;

  // @ts-ignore
  EdgeRuntime.waitUntil(runDiag(jobId, diagId, maxTokens, deadlineMs));

  return new Response(JSON.stringify({ status: 'started', diagId }), { headers: { 'Content-Type': 'application/json' } });
});
