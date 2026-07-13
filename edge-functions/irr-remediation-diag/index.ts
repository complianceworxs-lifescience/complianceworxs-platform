import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

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

async function runDiag(jobId: string, diagId: string, batchIndex: number, batchSize: number) {
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

  const gaps: any[] = prior[6].fields.gapFlags_list ?? [];
  const start = batchIndex * batchSize;
  const batchGaps = gaps.slice(start, start + batchSize);

  const systemPrompt = buildStageSystemPrompt({
    objective: `For ONLY the specific documentation gaps listed below (batch ${batchIndex + 1}), draft the remediation scaffold -- a documentation template that would close that gap. Other batches handle the remaining gaps separately.`,
    fields: ['remediationScaffold_list'],
    constraints: [
      'remediationScaffold_list entries are documentation SCAFFOLDS with bracketed blanks only ([reference], [name], [date]), never finished prose with invented specifics. A signatory is a required ROLE, never an invented name.',
      'One remediationScaffold_list entry per gap listed below -- no more, no fewer.',
    ],
    acceptanceCriteria: [],
  });
  const userPrompt = `${stageContextBlock(input)}\n\nGaps in THIS batch only (${batchGaps.length} of ${gaps.length} total):\n${JSON.stringify(batchGaps)}\n\nOutput ONLY a JSON object with exactly this key: remediationScaffold_list. Do not include any other keys. No prose outside the JSON.`;

  const inputSizeChars = systemPrompt.length + userPrompt.length;

  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300_000);
  let data: any;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 8000, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
      signal: controller.signal,
    });
    data = await res.json();
  } catch (e) {
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

  const items: any[] = parsed?.remediationScaffold_list ?? [];
  const perItemCharCounts = items.map((it: any) => JSON.stringify(it).length);

  const result = {
    batchIndex,
    batchGaps,
    inputSizeChars,
    inputTokens: data?.usage?.input_tokens ?? null,
    completionTokens: data?.usage?.output_tokens ?? null,
    stopReason: data?.stop_reason ?? null,
    latencyMs,
    totalOutputChars: rawText.length,
    parseSucceeded: !!parsed,
    parseError,
    itemCount: items.length,
    totalFieldCharCount: JSON.stringify(items).length,
    perItemCharCounts,
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
  const batchIndex = body.batchIndex ?? 0;
  const batchSize = body.batchSize ?? 3;

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/stage7_diag_results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, Prefer: 'return=representation' },
    body: JSON.stringify([{ job_id: jobId, status: 'running' }]),
  });
  const inserted = await insertRes.json();
  const diagId = inserted[0].id;

  // @ts-ignore
  EdgeRuntime.waitUntil(runDiag(jobId, diagId, batchIndex, batchSize));

  return new Response(JSON.stringify({ status: 'started', diagId }), { headers: { 'Content-Type': 'application/json' } });
});
