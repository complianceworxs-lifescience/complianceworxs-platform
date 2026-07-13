import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const STAGE6A_FIELDS = ['claimStatus_list', 'evidenceMatrix_list', 'evidenceTraceability_list'];

const INDUSTRY_CONTEXT: Record<string, string> = {
  pharma: 'FDA-regulated pharma/biologic/device GMP. Regs: 21 CFR 210/211, 820, ICH Q7/Q9/Q10. Decisions: batch release, CAPA closure, deviation disposition, change control, OOS closure.',
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

async function runDiag(jobId: string, diagId: string, batchIndex: number) {
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

  const evidenceList: any[] = prior[4].fields.evidenceReviewed_list ?? [];
  const batchEvidence = [evidenceList[batchIndex]];

  const systemPrompt = buildStageSystemPrompt({
    objective: `Using the evidence already reviewed and the rationale/gaps already established, classify claims and map evidence to claims -- but ONLY for the evidence items listed in this batch (batch ${batchIndex + 1} of ${evidenceList.length}). Other batches handle the remaining evidence items separately; do not attempt to cover evidence outside this batch.`,
    fields: STAGE6A_FIELDS,
    constraints: [
      'Each entry in claimStatus_list classifies one specific factual claim in the rationale as exactly one of: "Claimed in rationale", "Supported by attached evidence", "Not traceable in record". A value cited without supporting evidence is "Not traceable in record" -- never "Supported by attached evidence".',
      'evidenceMatrix_list and evidenceTraceability_list must map each claim to the specific evidence that supports it (or explicitly mark it unsupported), consistent with claimStatus_list -- this is analytical judgment, not formatting.',
      'Only classify claims and evidence that relate to the evidence items in THIS batch. Leave claims tied to other evidence for other batches to handle.',
    ],
    acceptanceCriteria: [],
  });
  const userPrompt = `${stageContextBlock(input)}\n\nEstablished rationale/gaps (full context, for identifying claims):\n${JSON.stringify({ ...prior[5].fields, ...prior[6].fields })}\n\nEvidence items in THIS batch only (${batchEvidence.length} of ${evidenceList.length} total):\n${JSON.stringify(batchEvidence)}\n\nOutput ONLY a JSON object with exactly these keys: ${STAGE6A_FIELDS.join(', ')}. Do not include any other keys. No prose outside the JSON.`;

  const inputSizeChars = systemPrompt.length + userPrompt.length;

  const t0 = Date.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 8000, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
  });
  const data = await res.json();
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
    for (const field of STAGE6A_FIELDS) {
      const value = parsed[field];
      fieldMeasurements[field] = {
        arrayLength: Array.isArray(value) ? value.length : null,
        charCount: JSON.stringify(value ?? null).length,
      };
    }
  }

  const rawFieldProgress: Record<string, any> = {};
  for (const field of STAGE6A_FIELDS) {
    const marker = `"${field}"`;
    const idx = rawText.indexOf(marker);
    if (idx === -1) { rawFieldProgress[field] = { present: false }; continue; }
    const otherIdxs = STAGE6A_FIELDS.filter((f) => f !== field).map((f) => rawText.indexOf(`"${f}"`, idx + marker.length)).filter((i) => i !== -1);
    const endIdx = otherIdxs.length ? Math.min(...otherIdxs) : rawText.length;
    rawFieldProgress[field] = { present: true, segmentCharCount: endIdx - idx };
  }

  const result = {
    batchIndex,
    evidenceItemText: evidenceList[batchIndex],
    inputSizeChars,
    inputTokens: data?.usage?.input_tokens ?? null,
    completionTokens: data?.usage?.output_tokens ?? null,
    stopReason: data?.stop_reason ?? null,
    latencyMs,
    totalOutputChars: rawText.length,
    parseSucceeded: !!parsed,
    parseError,
    fieldMeasurements,
    rawFieldProgress,
    claimCount: parsed?.claimStatus_list?.length ?? null,
    evidenceMatrixCount: parsed?.evidenceMatrix_list?.length ?? null,
    evidenceTraceabilityCount: parsed?.evidenceTraceability_list?.length ?? null,
    claimTexts: parsed?.claimStatus_list ? parsed.claimStatus_list.map((c: any) => c.claim ?? c) : null,
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
  const jobId = body.jobId;
  const batchIndex = body.batchIndex ?? 2;

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/stage7_diag_results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, Prefer: 'return=representation' },
    body: JSON.stringify([{ job_id: jobId, status: 'running' }]),
  });
  const inserted = await insertRes.json();
  const diagId = inserted[0].id;

  // @ts-ignore
  EdgeRuntime.waitUntil(runDiag(jobId, diagId, batchIndex));

  return new Response(JSON.stringify({ status: 'started', diagId }), { headers: { 'Content-Type': 'application/json' } });
});
