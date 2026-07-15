import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { PROMPT_CONSTRAINTS, constraintsFor, validateFieldItems, TYPE_CONTRACT_LINE } from './contract-generated.ts';
import { decideFailure } from './resilience/decide-failure.ts';

// Parse a provider Retry-After header (delta-seconds) into ms; null if absent/unparseable.
function parseRetryAfterMs(v: string | null): number | undefined {
  if (!v) return undefined;
  const secs = Number(v);
  return Number.isFinite(secs) ? Math.max(0, Math.round(secs * 1000)) : undefined;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const FN = `${SUPABASE_URL}/functions/v1`;

function sbHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, Prefer: 'return=representation' };
}

async function callJson(url: string, body: unknown, timeoutMs = 15000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function sbRest(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...sbHeaders(), ...(init.headers ?? {}) } });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---------- Anthropic call, shared by all AI stages ----------
async function callClaude(systemPrompt: string, userPrompt: string, deadlineMs: number, maxTokens = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  const start = Date.now();
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
      signal: controller.signal,
    });
    const data = await res.json();
    const latencyMs = Date.now() - start;
    if (data.error) return { ok: false as const, reason: 'api_error', httpStatus: res.status, retryAfterMs: parseRetryAfterMs(res.headers.get('retry-after')), message: data.error.message ?? 'Claude API error', latencyMs, stopReason: null, tokens: { input: null, output: null } };
    return { ok: true as const, text: data?.content?.[0]?.text ?? '', latencyMs, stopReason: data?.stop_reason ?? null, tokens: { input: data?.usage?.input_tokens ?? null, output: data?.usage?.output_tokens ?? null } };
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    return { ok: false as const, reason: isTimeout ? 'generation_timeout' : 'network_error', message: isTimeout ? `Stage exceeded its ${deadlineMs}ms deadline.` : `Call failed: ${err.message}`, latencyMs: Date.now() - start, stopReason: null, tokens: { input: null, output: null } };
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonSubset(text: string, requiredFields: string[]): { parsed: Record<string, any> | null; error: string | null } {
  const stripped = text.replace(/```json|```/g, '').trim();
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  const clean = first !== -1 && last !== -1 && last > first ? stripped.slice(first, last + 1) : stripped;
  try {
    const parsed = JSON.parse(clean);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { parsed: null, error: 'Parsed value is not a JSON object.' };
    const missing = requiredFields.filter((f) => !(f in parsed));
    if (missing.length) return { parsed: null, error: `Missing required fields: [${missing.join(', ')}]` };
    return { parsed, error: null };
  } catch (err) {
    return { parsed: null, error: `Not valid JSON: ${(err as Error).message}` };
  }
}

// ---------- Contract builder (unchanged from irr-job-worker) ----------
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}
const INDUSTRY_CONTEXT: Record<string, string> = {
  pharma: 'FDA-regulated pharma/biologic/device GMP. Regs: 21 CFR 210/211, 820, ICH Q7/Q9/Q10. Decisions: batch release, CAPA closure, deviation disposition, change control, OOS closure.',
  '503b': '503B sterile compounding under cGMP + USP <797>/<71>/<85>/<800>. Decisions: CSP batch release, EM excursion, sterility OOS, media fill failure, BUD extension. Sterility assurance is the core exposure.',
  food: 'FDA food under FSMA (21 CFR 117). Decisions: finished product release, CCP deviation, raw material acceptance, supplier verification, recall.',
  cosmetics: 'FDA cosmetics under MoCRA (FD&C Act 605-609). Decisions: safety substantiation, adverse event classification, ingredient/supplier change, recall.',
};
function buildIrrContract(input: any) {
  const contractId = `EC-IRR-${slugify(input.decisionDescription)}-${slugify(input.decisionOwner)}`;
  return {
    contractId,
    purpose: `Governs the Inspection Response Record for the decision: "${input.decisionDescription}".`,
    audience: input.audience,
    commercialObjective: 'Prove that a QMS-documented decision cannot demonstrate why the reasoning behind it is defensible without a record captured, pressure-tested, and preserved before the decision was finalized.',
    requiredInputs: ['decisionDescription', 'audience', 'evidenceSummary', 'riskContext', 'decisionOwner', 'authorizationDate'],
    requiredOutputs: [
      'investigatorQuestion', 'authorizationSummary', 'evidenceReviewed_list', 'riskEvaluation', 'alternativesConsidered',
      'authorizationRationale', 'regulatoryAlignment', 'residualExposureStatement', 'knownLimitations', 'gapFlags_list',
      'criticalGapsRanked_list', 'defensibilityRating', 'executiveBrief', 'executiveBriefBreakdown_list', 'evidenceMatrix_list',
      'evidenceTraceability_list', 'claimStatus_list', 'unsupportedClaims_list', 'inspectorChallenge_list', 'remediationScaffold_list',
    ],
    narrativePattern: 'NP-002',
    reasoningRules: ['RG-001', 'RG-004', 'RG-005', 'RG-009'],
    evidenceRules: ['ES-001', 'ES-003', 'ES-004', 'ES-006'],
    constraints: [
      'Must not name a specific real company in public-facing copy without sanitization.',
      'Must not claim this record replaces or is generated by a QMS, document repository, validation system, or CAPA/deviation tool -- those store documentation; this records the authorization logic behind the decision.',
      `Regulatory and decision context for this industry (${input.industry}): ${INDUSTRY_CONTEXT[input.industry] ?? ''}`,
      'defensibilityRating must be exactly one of: "Critical Exposure", "At Risk", "Defensible with Gaps", "Inspection-Ready".',
      'Each entry in claimStatus_list classifies one specific factual claim in the rationale as exactly one of: "Claimed in rationale", "Supported by attached evidence", "Not traceable in record".',
      'remediationScaffold_list entries are documentation SCAFFOLDS with bracketed blanks only, never finished prose with invented specifics.',
      'Every distinct deficiency is explained in full exactly once, in its primary home section.',
      'criticalGapsRanked_list names the 2-3 single most inspection-critical gaps, ranked by severity, by specific name.',
      'Every gapFlags_list entry pairs the gap with a specific imperative next action.',
      'knownLimitations is a single string field of flowing prose, never a list.',
      `Decision under review: ${input.decisionDescription}`,
      `Evidence summary provided: ${input.evidenceSummary}`,
      `Risk context provided: ${input.riskContext}`,
    ],
    acceptanceCriteria: [
      'Every claim asserted in authorizationRationale is either traceable to evidenceReviewed_list or explicitly named in unsupportedClaims_list.',
      'gapFlags_list names every distinct documentation gap identified elsewhere in the record.',
      'remediationScaffold_list contains only bracketed-blank scaffolds, never a finished paragraph with real-looking specifics.',
      'inspectorChallenge_list grounds every response in the record.',
      'criticalGapsRanked_list names specific gaps, not a repeat of counts already shown in the scorecard.',
      "No deficiency's full explanation appears in more than one section.",
      'Every gapFlags_list entry ends in an imperative action.',
    ],
    traceability: { inheritsFrom: ['Chapter 3', 'Chapter 5', 'Chapter 6'] },
    versionMetadata: { version: '3.0.0-staged', status: 'approved', dependencies: ['Chapter 1', 'Chapter 7', 'Chapter 8'] },
  };
}

// ---------- Stage field groups ----------
const STAGE4_FIELDS = ['evidenceReviewed_list', 'riskEvaluation', 'alternativesConsidered', 'regulatoryAlignment', 'residualExposureStatement'];
const STAGE5A_FIELDS = ['investigatorQuestion', 'authorizationSummary', 'authorizationRationale', 'knownLimitations', 'defensibilityRating'];
const STAGE5B_FIELDS = ['gapFlags_list', 'criticalGapsRanked_list'];
const STAGE6A_FIELDS = ['claimStatus_list', 'evidenceMatrix_list', 'evidenceTraceability_list'];
const STAGE6B_FIELDS = ['unsupportedClaims_list', 'inspectorChallenge_list', 'remediationScaffold_list'];

function buildStageSystemPrompt(opts: { objective: string; fields: string[]; constraints: string[]; acceptanceCriteria: string[] }): string {
  const parts = [
    `You are generating one section of an Inspection Response Record (IRR) -- a regulatory defense artifact. This is one stage of a multi-stage pipeline; you are NOT generating the full record, only the fields listed below.`,
    `Stage objective: ${opts.objective}`,
    `Required output fields for this stage: ${opts.fields.join(', ')}`,
    TYPE_CONTRACT_LINE,
  ];
  if (opts.constraints.length) parts.push(`Constraints governing these fields:\n- ${opts.constraints.join('\n- ')}`);
  if (opts.acceptanceCriteria.length) parts.push(`Acceptance criteria for these fields:\n- ${opts.acceptanceCriteria.join('\n- ')}`);
  return parts.join('\n\n');
}

function stageContextBlock(input: any): string {
  return `Decision under review: ${input.decisionDescription}\nAudience: ${input.audience}\nEvidence summary provided: ${input.evidenceSummary}\nRisk context provided: ${input.riskContext}\nRegulatory context (${input.industry}): ${INDUSTRY_CONTEXT[input.industry] ?? ''}`;
}

const AI_STAGE_BUDGET = { maxFields: 7, maxCompletionTokens: 2600, maxRuntimeMs: 75_000 };

function checkBudget(fieldCount: number, tokens: { input: number | null; output: number | null } | undefined, durationMs: number): boolean {
  if (fieldCount > AI_STAGE_BUDGET.maxFields) return false;
  if (tokens?.output != null && tokens.output > AI_STAGE_BUDGET.maxCompletionTokens) return false;
  if (durationMs > AI_STAGE_BUDGET.maxRuntimeMs) return false;
  return true;
}

// ---------- Telemetry (additive, Milestone 6 pre-work) ----------
interface CallTelemetry {
  batchNumber: number;
  promptTokens: number | null;
  completionTokens: number | null;
  stopReason: string | null;
  outputCharCount: number | null;
  configuredMaxOutputTokens: number | null;
}

interface StageCtx {
  checkpoint: any;
  saveCheckpoint: (data: any) => Promise<void>;
  telemetry: CallTelemetry | null;
  recordCall: (batchNumber: number, gen: any, configuredMaxOutputTokens: number) => void;
}

const STAGES: { stage: number; name: string; kind: 'code' | 'ai'; run: (input: any, prior: Record<number, any>, ctx: StageCtx) => Promise<any> }[] = [

  { stage: 1, name: 'validate_contract', kind: 'code', run: async (input) => {
      const contract = buildIrrContract(input);
      const res = await callJson(`${FN}/validate-editorial-contract`, contract, 8000);
      if (res?.status !== 'valid') throw { reason: 'contract_invalid', message: JSON.stringify(res?.issues ?? res) };
      return { contract };
  }},

  { stage: 2, name: 'compile_execution_spec', kind: 'code', run: async (_input, prior) => {
      const res = await callJson(`${FN}/compile-editorial-contract`, prior[1].contract, 8000);
      if (res?.status !== 'compiled') throw { reason: 'execution_compile_failed', message: JSON.stringify(res?.issues ?? res) };
      return { executionSpecification: res.executionSpecification };
  }},

  { stage: 3, name: 'compile_prompt_spec', kind: 'code', run: async (_input, prior) => {
      const res = await callJson(`${FN}/compile-prompt-specification`, { executionSpecification: prior[2].executionSpecification, targetRuntime: 'claude' }, 8000);
      if (res?.status !== 'compiled') throw { reason: 'prompt_package_invalid', message: JSON.stringify(res?.issues ?? res) };
      return { promptPackage: res.promptPackage };
  }},

  { stage: 4, name: 'evidence_risk_reasoning', kind: 'ai', run: async (input, prior, ctx) => {
      const systemPrompt = buildStageSystemPrompt({
        objective: 'Review the evidence and regulatory risk for this decision. Establish what evidence was reviewed, how risk was evaluated, what alternatives were considered, how the decision aligns with regulatory expectations, and what residual exposure remains.',
        fields: STAGE4_FIELDS,
        constraints: [
          'Must not claim this record replaces or is generated by a QMS, document repository, validation system, or CAPA/deviation tool -- those store documentation; this records the authorization logic behind the decision.',
          'Must not name a specific real company in public-facing copy without sanitization.',
          'Integrate all points into one flowing paragraph per prose field -- never bullets or numbered items.',
          ...constraintsFor(['alternativesConsidered', 'riskEvaluation', 'regulatoryAlignment', 'residualExposureStatement', 'evidenceReviewed_list']),
        ],
        acceptanceCriteria: [],
      });
      const userPrompt = `${stageContextBlock(input)}\n\nOutput ONLY a JSON object with exactly these keys: ${STAGE4_FIELDS.join(', ')}. Do not include any other keys. No prose outside the JSON.`;
      const gen = await callClaude(systemPrompt, userPrompt, 110_000, 7000);
      ctx.recordCall(1, gen, 7000);
      if (!gen.ok) throw { reason: gen.reason, httpStatus: (gen as any).httpStatus, retryAfterMs: (gen as any).retryAfterMs, message: gen.message };
      const { parsed, error } = parseJsonSubset(gen.text, STAGE4_FIELDS);
      if (error) throw { reason: 'invalid_json_output', message: error };
      validateFieldItems('evidenceReviewed_list', Array.isArray(parsed.evidenceReviewed_list) ? parsed.evidenceReviewed_list : [], 'Stage 4');
      return { fields: parsed, tokens: gen.tokens, promptChars: systemPrompt.length + userPrompt.length };
  }},

  { stage: 5, name: 'authorization_reasoning', kind: 'ai', run: async (input, prior, ctx) => {
      const systemPrompt = buildStageSystemPrompt({
        objective: "Using the evidence and risk analysis already established, determine whether the decision is defensible: write the authorization rationale and rate overall defensibility. Gap identification happens in a later stage -- focus here on the reasoning narrative.",
        fields: STAGE5A_FIELDS,
        constraints: [
          'Every distinct deficiency is explained in full exactly once, in knownLimitations.',
          ...constraintsFor(['defensibilityRating', 'knownLimitations', 'investigatorQuestion', 'authorizationSummary', 'authorizationRationale']),
        ],
        acceptanceCriteria: [],
      });
      const userPrompt = `${stageContextBlock(input)}\n\nEstablished evidence and risk analysis from the prior stage (already finalized -- build on it, do not restate or contradict it):\n${JSON.stringify(prior[4].fields)}\n\nOutput ONLY a JSON object with exactly these keys: ${STAGE5A_FIELDS.join(', ')}. Do not include any other keys. No prose outside the JSON.`;
      const gen = await callClaude(systemPrompt, userPrompt, 90_000, AI_STAGE_BUDGET.maxCompletionTokens);
      ctx.recordCall(1, gen, AI_STAGE_BUDGET.maxCompletionTokens);
      if (!gen.ok) throw { reason: gen.reason, httpStatus: (gen as any).httpStatus, retryAfterMs: (gen as any).retryAfterMs, message: gen.message };
      const { parsed, error } = parseJsonSubset(gen.text, STAGE5A_FIELDS);

      const rawFieldProgress: Record<string, any> = {};
      for (const field of STAGE5A_FIELDS) {
        const marker = `"${field}"`;
        const idx = gen.text.indexOf(marker);
        if (idx === -1) { rawFieldProgress[field] = { present: false }; continue; }
        const otherIdxs = STAGE5A_FIELDS.filter((f) => f !== field).map((f) => gen.text.indexOf(`"${f}"`, idx + marker.length)).filter((i) => i !== -1);
        const endIdx = otherIdxs.length ? Math.min(...otherIdxs) : gen.text.length;
        const segment = gen.text.slice(idx, endIdx);
        const approxCompleteItems = (segment.match(/\}\s*,\s*\{/g) || []).length + (segment.includes('{') && field.endsWith('_list') ? 1 : 0);
        rawFieldProgress[field] = { present: true, segmentCharCount: segment.length, approxCompleteItems };
      }
      const diagnostics = {
        stopReason: gen.stopReason ?? null,
        totalCharCount: gen.text.length,
        parseSucceeded: !!parsed,
        parseError: error ?? null,
        rawFieldProgress,
      };

      if (error) throw { reason: 'invalid_json_output', message: `${error} -- diagnostics: ${JSON.stringify(diagnostics)}` };
      return { fields: { ...parsed, diagnostics }, tokens: gen.tokens, promptChars: systemPrompt.length + userPrompt.length };
  }},

  { stage: 6, name: 'gap_analysis', kind: 'ai', run: async (input, prior, ctx) => {
      const systemPrompt = buildStageSystemPrompt({
        objective: "Using the authorization reasoning already established, identify and rank the documentation gaps in this decision.",
        fields: STAGE5B_FIELDS,
        constraints: [
          'criticalGapsRanked_list names the 2-3 single most inspection-critical gaps, ranked by severity, by specific name.',
          'Every gapFlags_list entry pairs the gap with a specific imperative next action.',
          ...constraintsFor(['gapFlags_list', 'criticalGapsRanked_list']),
        ],
        acceptanceCriteria: [
          'gapFlags_list names every distinct documentation gap identified elsewhere in the record.',
        ],
      });
      const userPrompt = `${stageContextBlock(input)}\n\nEstablished evidence and risk analysis:\n${JSON.stringify(prior[4].fields)}\n\nEstablished authorization reasoning from the prior stage (already finalized -- build on it, do not restate or contradict it):\n${JSON.stringify(prior[5].fields)}\n\nOutput ONLY a JSON object with exactly these keys: ${STAGE5B_FIELDS.join(', ')}. Do not include any other keys. No prose outside the JSON.`;
      const gen = await callClaude(systemPrompt, userPrompt, 90_000, AI_STAGE_BUDGET.maxCompletionTokens);
      ctx.recordCall(1, gen, AI_STAGE_BUDGET.maxCompletionTokens);
      if (!gen.ok) throw { reason: gen.reason, httpStatus: (gen as any).httpStatus, retryAfterMs: (gen as any).retryAfterMs, message: gen.message };
      const { parsed, error } = parseJsonSubset(gen.text, STAGE5B_FIELDS);

      const rawFieldProgress: Record<string, any> = {};
      for (const field of STAGE5B_FIELDS) {
        const marker = `"${field}"`;
        const idx = gen.text.indexOf(marker);
        if (idx === -1) { rawFieldProgress[field] = { present: false }; continue; }
        const otherIdxs = STAGE5B_FIELDS.filter((f) => f !== field).map((f) => gen.text.indexOf(`"${f}"`, idx + marker.length)).filter((i) => i !== -1);
        const endIdx = otherIdxs.length ? Math.min(...otherIdxs) : gen.text.length;
        const segment = gen.text.slice(idx, endIdx);
        const approxCompleteItems = (segment.match(/\}\s*,\s*\{/g) || []).length + (segment.includes('{') && field.endsWith('_list') ? 1 : 0);
        rawFieldProgress[field] = { present: true, segmentCharCount: segment.length, approxCompleteItems };
      }
      const diagnostics = {
        stopReason: gen.stopReason ?? null,
        totalCharCount: gen.text.length,
        parseSucceeded: !!parsed,
        parseError: error ?? null,
        rawFieldProgress,
      };

      if (error) throw { reason: 'invalid_json_output', message: `${error} -- diagnostics: ${JSON.stringify(diagnostics)}` };
      validateFieldItems('gapFlags_list', Array.isArray(parsed.gapFlags_list) ? parsed.gapFlags_list : [], 'Stage 6');
      return { fields: { ...parsed, diagnostics }, tokens: gen.tokens, promptChars: systemPrompt.length + userPrompt.length };
  }},

  { stage: 7, name: 'claim_status', kind: 'ai', run: async (input, prior, ctx) => {
      const evidenceList: any[] = prior[4].fields.evidenceReviewed_list ?? [];
      const BATCH_SIZE = 1;
      const HARD_CEILING_MS = 380_000;
      const CALL_BUDGET_MS = 90_000;
      const BUDGET_HEADROOM_TOKENS = 2_300;
      const stageT0 = Date.now();
      const batches: any[][] = [];
      for (let i = 0; i < evidenceList.length; i += BATCH_SIZE) batches.push(evidenceList.slice(i, i + BATCH_SIZE));
      if (batches.length === 0) batches.push([]);

      const resumed = ctx?.checkpoint?.partials as any[][] | undefined;
      const partials: any[][] = Array.isArray(resumed) ? [...resumed] : [];
      let totalInputTokens = ctx?.checkpoint?.totalInputTokens ?? 0;
      let maxBatchOutputTokens = ctx?.checkpoint?.maxBatchOutputTokens ?? 0;
      let promptCharsSum = ctx?.checkpoint?.promptCharsSum ?? 0;
      let headroomBreaches = ctx?.checkpoint?.headroomBreaches ?? 0;

      for (let b = partials.length; b < batches.length; b++) {
        if (Date.now() - stageT0 + CALL_BUDGET_MS > HARD_CEILING_MS) {
          throw { reason: 'generation_timeout', message: `Stage-level deadline reached after ${b}/${batches.length} batches -- bailing before the platform's hard kill so this can be retried cleanly (${b} batches already checkpointed).` };
        }
        const batchEvidence = batches[b];
        const systemPrompt = buildStageSystemPrompt({
          objective: `Using the evidence already reviewed and the rationale/gaps already established, classify every factual claim tied to the evidence item listed below (batch ${b + 1} of ${batches.length}). Other batches handle claims tied to other evidence items separately; do not attempt to cover evidence outside this batch.`,
          fields: ['claimStatus_list'],
          constraints: [
            'Each entry in claimStatus_list classifies one specific factual claim in the rationale as exactly one of: "Claimed in rationale", "Supported by attached evidence", "Not traceable in record". A value cited without supporting evidence is "Not traceable in record" -- never "Supported by attached evidence".',
            'Only classify claims that relate to the evidence item in THIS batch. Leave claims tied to other evidence for other batches to handle.',
            ...constraintsFor(['claimStatus_list']),
          ],
          acceptanceCriteria: [],
        });
        const userPrompt = `${stageContextBlock(input)}\n\nEstablished rationale/gaps (full context, for identifying claims):\n${JSON.stringify({ ...prior[5].fields, ...prior[6].fields })}\n\nEvidence item in THIS batch only (${batchEvidence.length} of ${evidenceList.length} total):\n${JSON.stringify(batchEvidence)}\n\nOutput ONLY a JSON object with exactly this key: claimStatus_list. Do not include any other keys. No prose outside the JSON.`;
        promptCharsSum += systemPrompt.length + userPrompt.length;

        const gen = await callClaude(systemPrompt, userPrompt, CALL_BUDGET_MS, AI_STAGE_BUDGET.maxCompletionTokens);
        ctx.recordCall(b + 1, gen, AI_STAGE_BUDGET.maxCompletionTokens);
        if (!gen.ok) throw { reason: gen.reason, httpStatus: (gen as any).httpStatus, retryAfterMs: (gen as any).retryAfterMs, message: `Batch ${b + 1}/${batches.length} failed: ${gen.message} (${partials.length} batches already checkpointed)` };
        totalInputTokens += gen.tokens.input ?? 0;
        maxBatchOutputTokens = Math.max(maxBatchOutputTokens, gen.tokens.output ?? 0);
        if ((gen.tokens.output ?? 0) > BUDGET_HEADROOM_TOKENS) headroomBreaches += 1;
        const { parsed, error } = parseJsonSubset(gen.text, ['claimStatus_list']);
        if (error) throw { reason: 'invalid_json_output', message: `Batch ${b + 1}/${batches.length} failed: ${error} (${partials.length} batches already checkpointed)` };

        const idOffset = partials.reduce((acc, p) => acc + p.length, 0);
        const rawClaims: any[] = Array.isArray(parsed.claimStatus_list) ? parsed.claimStatus_list : [];
        validateFieldItems('claimStatus_list', rawClaims, `Batch ${b + 1}/${batches.length} (${partials.length} batches already checkpointed)`);
        const taggedClaims = rawClaims.map((c: any, i: number) => ({ ...c, id: `claim_${idOffset + i}`, evidenceIndex: b }));
        partials.push(taggedClaims);

        await ctx.saveCheckpoint({ partials, totalInputTokens, maxBatchOutputTokens, promptCharsSum, headroomBreaches });
      }

      const merged = partials.flat();
      const seen = new Set<string>();
      const claimStatus_list = merged.filter((entry: any) => {
        const key = entry.claim ?? JSON.stringify(entry);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const mapReduceMeta = {
        evidenceItemCount: evidenceList.length,
        batchCount: batches.length,
        batchSize: BATCH_SIZE,
        outputItemCount: claimStatus_list.length,
        duplicatesRemoved: merged.length - claimStatus_list.length,
        maxSingleBatchCompletionTokens: maxBatchOutputTokens,
        withinBudgetHeadroom: headroomBreaches === 0,
        headroomBreaches,
      };

      return {
        fields: { claimStatus_list, mapReduceMeta },
        tokens: { input: totalInputTokens, output: maxBatchOutputTokens },
        promptChars: promptCharsSum,
      };
  }},

  { stage: 8, name: 'evidence_traceability', kind: 'ai', run: async (input, prior, ctx) => {
      const evidenceList: any[] = prior[4].fields.evidenceReviewed_list ?? [];
      const allClaims: any[] = prior[7].fields.claimStatus_list ?? [];
      const BATCH_SIZE = 1;
      const HARD_CEILING_MS = 380_000;
      const CALL_BUDGET_MS = 90_000;
      const BUDGET_HEADROOM_TOKENS = 2_300;
      const stageT0 = Date.now();
      const batches: any[][] = [];
      for (let i = 0; i < evidenceList.length; i += BATCH_SIZE) batches.push(evidenceList.slice(i, i + BATCH_SIZE));
      if (batches.length === 0) batches.push([]);

      const resumed = ctx?.checkpoint?.partials as { evidenceMatrix_list: any[]; evidenceTraceability_list: any[] }[] | undefined;
      const partials: { evidenceMatrix_list: any[]; evidenceTraceability_list: any[] }[] = Array.isArray(resumed) ? [...resumed] : [];
      let totalInputTokens = ctx?.checkpoint?.totalInputTokens ?? 0;
      let maxBatchOutputTokens = ctx?.checkpoint?.maxBatchOutputTokens ?? 0;
      let promptCharsSum = ctx?.checkpoint?.promptCharsSum ?? 0;
      let headroomBreaches = ctx?.checkpoint?.headroomBreaches ?? 0;

      for (let b = partials.length; b < batches.length; b++) {
        if (Date.now() - stageT0 + CALL_BUDGET_MS > HARD_CEILING_MS) {
          throw { reason: 'generation_timeout', message: `Stage-level deadline reached after ${b}/${batches.length} batches -- bailing before the platform's hard kill so this can be retried cleanly (${b} batches already checkpointed).` };
        }
        const batchEvidence = batches[b];
        const claimsForThisEvidence = allClaims.filter((c: any) => c.evidenceIndex === b);
        const systemPrompt = buildStageSystemPrompt({
          objective: `For ONLY the specific evidence item listed below (batch ${b + 1} of ${batches.length}), map each of the already-classified claims tied to it to the specific evidence that supports it (or explicitly mark it unsupported). Every claim listed below must get exactly one evidenceTraceability_list entry, referencing its exact claimId. Other batches handle claims tied to other evidence items separately.`,
          fields: STAGE6A_FIELDS.filter((f) => f !== 'claimStatus_list'),
          constraints: [
            'evidenceMatrix_list and evidenceTraceability_list must map each claim to the specific evidence that supports it (or explicitly mark it unsupported), consistent with the claim\'s already-established status -- this is analytical judgment, not formatting.',
            'Every evidenceTraceability_list entry MUST include a claimId field set to the exact claimId of the claim it addresses, copied verbatim from the claims listed below.',
            'Produce exactly one evidenceTraceability_list entry per claim listed below -- no more, no fewer, no invented claims.',
            'evidenceTraceability_list entries must not contradict the status already established for that claim -- do not mark a claim "Supported by attached evidence" if it was already classified "Not traceable in record".',
            ...constraintsFor(['evidenceMatrix_list', 'evidenceTraceability_list']),
          ],
          acceptanceCriteria: [],
        });
        const userPrompt = `${stageContextBlock(input)}\n\nEvidence item in THIS batch only (${batchEvidence.length} of ${evidenceList.length} total):\n${JSON.stringify(batchEvidence)}\n\nClaims already classified for THIS evidence item, with their claimId and established status (already finalized -- do not restate or contradict, just trace to evidence):\n${JSON.stringify(claimsForThisEvidence.map((c: any) => ({ claimId: c.id, claim: c.claim, status: c.status })))}\n\nOutput ONLY a JSON object with exactly these keys: evidenceMatrix_list, evidenceTraceability_list. Do not include any other keys. No prose outside the JSON.`;
        promptCharsSum += systemPrompt.length + userPrompt.length;

        const gen = await callClaude(systemPrompt, userPrompt, CALL_BUDGET_MS, AI_STAGE_BUDGET.maxCompletionTokens);
        ctx.recordCall(b + 1, gen, AI_STAGE_BUDGET.maxCompletionTokens);
        if (!gen.ok) throw { reason: gen.reason, httpStatus: (gen as any).httpStatus, retryAfterMs: (gen as any).retryAfterMs, message: `Batch ${b + 1}/${batches.length} failed: ${gen.message} (${partials.length} batches already checkpointed)` };
        totalInputTokens += gen.tokens.input ?? 0;
        maxBatchOutputTokens = Math.max(maxBatchOutputTokens, gen.tokens.output ?? 0);
        if ((gen.tokens.output ?? 0) > BUDGET_HEADROOM_TOKENS) headroomBreaches += 1;
        const { parsed, error } = parseJsonSubset(gen.text, ['evidenceMatrix_list', 'evidenceTraceability_list']);
        if (error) throw { reason: 'invalid_json_output', message: `Batch ${b + 1}/${batches.length} failed: ${error} (${partials.length} batches already checkpointed)` };

        const traceEntries: any[] = Array.isArray(parsed.evidenceTraceability_list) ? parsed.evidenceTraceability_list : [];
        const matrixEntries: any[] = Array.isArray(parsed.evidenceMatrix_list) ? parsed.evidenceMatrix_list : [];
        validateFieldItems('evidenceTraceability_list', traceEntries, `Batch ${b + 1}/${batches.length} (${partials.length} batches already checkpointed)`);
        validateFieldItems('evidenceMatrix_list', matrixEntries, `Batch ${b + 1}/${batches.length} (${partials.length} batches already checkpointed)`);
        const traceByClaimId = new Map<string, any[]>();
        for (const e of traceEntries) {
          const cid = e.claimId;
          if (!traceByClaimId.has(cid)) traceByClaimId.set(cid, []);
          traceByClaimId.get(cid)!.push(e);
        }
        for (const claim of claimsForThisEvidence) {
          const matches = traceByClaimId.get(claim.id) ?? [];
          if (matches.length === 0) throw { reason: 'traceability_coverage_omitted', message: `Batch ${b + 1}/${batches.length}: claim ${claim.id} has no evidenceTraceability_list entry (${partials.length} batches already checkpointed).` };
          if (matches.length > 1) throw { reason: 'traceability_coverage_duplicated', message: `Batch ${b + 1}/${batches.length}: claim ${claim.id} has ${matches.length} evidenceTraceability_list entries, expected exactly 1 (${partials.length} batches already checkpointed).` };
        }

        partials.push({ evidenceMatrix_list: matrixEntries, evidenceTraceability_list: traceEntries });

        await ctx.saveCheckpoint({ partials, totalInputTokens, maxBatchOutputTokens, promptCharsSum, headroomBreaches });
      }

      const evidenceMatrix_list = partials.flatMap((p) => p.evidenceMatrix_list ?? []);
      const evidenceTraceability_list = partials.flatMap((p) => p.evidenceTraceability_list ?? []);

      const traceCountByClaimId = new Map<string, number>();
      for (const e of evidenceTraceability_list) traceCountByClaimId.set(e.claimId, (traceCountByClaimId.get(e.claimId) ?? 0) + 1);
      const omitted = allClaims.filter((c: any) => !traceCountByClaimId.has(c.id));
      const duplicated = allClaims.filter((c: any) => (traceCountByClaimId.get(c.id) ?? 0) > 1);
      if (omitted.length > 0 || duplicated.length > 0) {
        throw { reason: 'traceability_coverage_mismatch', message: `Coverage mismatch between claimStatus_list (${allClaims.length} claims) and evidenceTraceability_list: ${omitted.length} omitted, ${duplicated.length} duplicated.` };
      }

      const mapReduceMeta = {
        evidenceItemCount: evidenceList.length,
        batchCount: batches.length,
        batchSize: BATCH_SIZE,
        claimCount: allClaims.length,
        evidenceTraceabilityCount: evidenceTraceability_list.length,
        maxSingleBatchCompletionTokens: maxBatchOutputTokens,
        withinBudgetHeadroom: headroomBreaches === 0,
        headroomBreaches,
      };

      return {
        fields: { evidenceMatrix_list, evidenceTraceability_list, mapReduceMeta },
        tokens: { input: totalInputTokens, output: maxBatchOutputTokens },
        promptChars: promptCharsSum,
      };
  }},

  { stage: 9, name: 'unsupported_claims', kind: 'ai', run: async (input, prior, ctx) => {
      const allClaims: any[] = prior[7].fields.claimStatus_list ?? [];
      const unsupported = allClaims.filter((c: any) => c?.status === 'Not traceable in record');
      const BATCH_SIZE = 4;
      const HARD_CEILING_MS = 380_000;
      const CALL_BUDGET_MS = 90_000;
      const stageT0 = Date.now();
      const batches: any[][] = [];
      for (let i = 0; i < unsupported.length; i += BATCH_SIZE) batches.push(unsupported.slice(i, i + BATCH_SIZE));
      if (batches.length === 0) batches.push([]);

      const resumed = ctx?.checkpoint?.partials as any[][] | undefined;
      const partials: any[][] = Array.isArray(resumed) ? [...resumed] : [];
      let totalInputTokens = ctx?.checkpoint?.totalInputTokens ?? 0;
      let maxBatchOutputTokens = ctx?.checkpoint?.maxBatchOutputTokens ?? 0;
      let promptCharsSum = ctx?.checkpoint?.promptCharsSum ?? 0;

      for (let b = partials.length; b < batches.length; b++) {
        if (Date.now() - stageT0 + CALL_BUDGET_MS > HARD_CEILING_MS) {
          throw { reason: 'generation_timeout', message: `Stage-level deadline reached after ${b}/${batches.length} claim batches -- bailing before the platform's hard kill so this can be retried cleanly (${b} batches already checkpointed).` };
        }
        const batchClaims = batches[b];
        const systemPrompt = buildStageSystemPrompt({
          objective: `For ONLY the specific claims listed below (batch ${b + 1} of ${batches.length}, all already classified as unsupported), write the unsupportedClaims_list entries explaining what the record fails to establish for each. Other batches handle the remaining unsupported claims separately.`,
          fields: ['unsupportedClaims_list'],
          constraints: [
            'unsupportedClaims_list entries are framed as what the record fails to establish -- never as coaching on what to say or not say to an investigator.',
            'Produce exactly one unsupportedClaims_list entry per claim listed below -- no more, no fewer.',
            ...constraintsFor(['unsupportedClaims_list']),
          ],
          acceptanceCriteria: [],
        });
        const userPrompt = `${stageContextBlock(input)}\n\nClaims in THIS batch only, already classified as unsupported (${batchClaims.length} of ${unsupported.length} total unsupported claims):\n${JSON.stringify(batchClaims)}\n\nOutput ONLY a JSON object with exactly this key: unsupportedClaims_list. Do not include any other keys. No prose outside the JSON.`;
        promptCharsSum += systemPrompt.length + userPrompt.length;

        const gen = await callClaude(systemPrompt, userPrompt, CALL_BUDGET_MS, AI_STAGE_BUDGET.maxCompletionTokens);
        ctx.recordCall(b + 1, gen, AI_STAGE_BUDGET.maxCompletionTokens);
        if (!gen.ok) throw { reason: gen.reason, httpStatus: (gen as any).httpStatus, retryAfterMs: (gen as any).retryAfterMs, message: `Claim batch ${b + 1}/${batches.length} failed: ${gen.message} (${partials.length} batches already checkpointed)` };
        totalInputTokens += gen.tokens.input ?? 0;
        maxBatchOutputTokens = Math.max(maxBatchOutputTokens, gen.tokens.output ?? 0);
        const { parsed, error } = parseJsonSubset(gen.text, ['unsupportedClaims_list']);
        if (error) throw { reason: 'invalid_json_output', message: `Claim batch ${b + 1}/${batches.length} failed: ${error} (${partials.length} batches already checkpointed)` };
        const items: any[] = Array.isArray(parsed.unsupportedClaims_list) ? parsed.unsupportedClaims_list : [];
        validateFieldItems('unsupportedClaims_list', items, `Claim batch ${b + 1}/${batches.length} (${partials.length} batches already checkpointed)`);
        partials.push(items);

        await ctx.saveCheckpoint({ partials, totalInputTokens, maxBatchOutputTokens, promptCharsSum });
      }

      const merged = partials.flat();
      const seen = new Set<string>();
      const unsupportedClaims_list = merged.filter((entry: any) => {
        const key = JSON.stringify(entry);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const mapReduceMeta = {
        unsupportedClaimCount: unsupported.length,
        batchCount: batches.length,
        batchSize: BATCH_SIZE,
        outputItemCount: unsupportedClaims_list.length,
        duplicatesRemoved: merged.length - unsupportedClaims_list.length,
        omittedCount: unsupported.length - unsupportedClaims_list.length,
      };
      if (mapReduceMeta.omittedCount !== 0) {
        throw { reason: 'unsupported_claims_coverage_mismatch', message: `Expected ${unsupported.length} unsupportedClaims_list entries (one per unsupported claim), got ${unsupportedClaims_list.length}.` };
      }

      return {
        fields: { unsupportedClaims_list, mapReduceMeta },
        tokens: { input: totalInputTokens, output: maxBatchOutputTokens },
        promptChars: promptCharsSum,
      };
  }},

  { stage: 10, name: 'inspector_challenge', kind: 'ai', run: async (input, prior, ctx) => {
      const gaps: any[] = prior[6].fields.gapFlags_list ?? [];
      const BATCH_SIZE = 4;
      const HARD_CEILING_MS = 380_000;
      const CALL_BUDGET_MS = 90_000;
      const stageT0 = Date.now();
      const batches: any[][] = [];
      for (let i = 0; i < gaps.length; i += BATCH_SIZE) batches.push(gaps.slice(i, i + BATCH_SIZE));
      if (batches.length === 0) batches.push([]);

      const resumed = ctx?.checkpoint?.partials as any[][] | undefined;
      const partials: any[][] = Array.isArray(resumed) ? [...resumed] : [];
      let totalInputTokens = ctx?.checkpoint?.totalInputTokens ?? 0;
      let maxBatchOutputTokens = ctx?.checkpoint?.maxBatchOutputTokens ?? 0;
      let promptCharsSum = ctx?.checkpoint?.promptCharsSum ?? 0;

      for (let b = partials.length; b < batches.length; b++) {
        if (Date.now() - stageT0 + CALL_BUDGET_MS > HARD_CEILING_MS) {
          throw { reason: 'generation_timeout', message: `Stage-level deadline reached after ${b}/${batches.length} gap batches -- bailing before the platform's hard kill so this can be retried cleanly (${b} batches already checkpointed).` };
        }
        const batchGaps = batches[b];
        const systemPrompt = buildStageSystemPrompt({
          objective: `For ONLY the specific documentation gaps listed below (batch ${b + 1} of ${batches.length}), draft the inspector-facing challenge response an investigator would raise about that gap and how the record answers it. Other batches handle the remaining gaps separately.`,
          fields: ['inspectorChallenge_list'],
          constraints: [
            'One inspectorChallenge_list entry per gap listed below -- no more, no fewer.',
            ...constraintsFor(['inspectorChallenge_list']),
          ],
          acceptanceCriteria: [
            'inspectorChallenge_list grounds every response in the record -- never asserts a fact not present in the inputs.',
          ],
        });
        const userPrompt = `${stageContextBlock(input)}\n\nGaps in THIS batch only (${batchGaps.length} of ${gaps.length} total):\n${JSON.stringify(batchGaps)}\n\nOutput ONLY a JSON object with exactly this key: inspectorChallenge_list. Do not include any other keys. No prose outside the JSON.`;
        promptCharsSum += systemPrompt.length + userPrompt.length;

        const gen = await callClaude(systemPrompt, userPrompt, CALL_BUDGET_MS, AI_STAGE_BUDGET.maxCompletionTokens);
        ctx.recordCall(b + 1, gen, AI_STAGE_BUDGET.maxCompletionTokens);
        if (!gen.ok) throw { reason: gen.reason, httpStatus: (gen as any).httpStatus, retryAfterMs: (gen as any).retryAfterMs, message: `Gap batch ${b + 1}/${batches.length} failed: ${gen.message} (${partials.length} batches already checkpointed)` };
        totalInputTokens += gen.tokens.input ?? 0;
        maxBatchOutputTokens = Math.max(maxBatchOutputTokens, gen.tokens.output ?? 0);
        const { parsed, error } = parseJsonSubset(gen.text, ['inspectorChallenge_list']);
        if (error) throw { reason: 'invalid_json_output', message: `Gap batch ${b + 1}/${batches.length} failed: ${error} (${partials.length} batches already checkpointed)` };
        const items: any[] = Array.isArray(parsed.inspectorChallenge_list) ? parsed.inspectorChallenge_list : [];
        validateFieldItems('inspectorChallenge_list', items, `Gap batch ${b + 1}/${batches.length} (${partials.length} batches already checkpointed)`);
        partials.push(items);

        await ctx.saveCheckpoint({ partials, totalInputTokens, maxBatchOutputTokens, promptCharsSum });
      }

      const merged = partials.flat();
      const seen = new Set<string>();
      const inspectorChallenge_list = merged.filter((entry: any) => {
        const key = JSON.stringify(entry);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const mapReduceMeta = {
        gapCount: gaps.length,
        batchCount: batches.length,
        batchSize: BATCH_SIZE,
        outputItemCount: inspectorChallenge_list.length,
        duplicatesRemoved: merged.length - inspectorChallenge_list.length,
        omittedCount: gaps.length - inspectorChallenge_list.length,
      };
      if (mapReduceMeta.omittedCount !== 0) {
        throw { reason: 'inspector_challenge_coverage_mismatch', message: `Expected ${gaps.length} inspectorChallenge_list entries (one per gap), got ${inspectorChallenge_list.length}.` };
      }

      return {
        fields: { inspectorChallenge_list, mapReduceMeta },
        tokens: { input: totalInputTokens, output: maxBatchOutputTokens },
        promptChars: promptCharsSum,
      };
  }},

  // Stage 11 business logic (batching, coverage-mismatch check, dedup) is UNCHANGED.
  // Only addition: ctx.recordCall(...) after the model call, for telemetry.
  { stage: 11, name: 'remediation_scaffold', kind: 'ai', run: async (input, prior, ctx) => {
      const gaps: any[] = prior[6].fields.gapFlags_list ?? [];
      const BATCH_SIZE = 1;
      const HARD_CEILING_MS = 380_000;
      const CALL_BUDGET_MS = 90_000;
      const stageT0 = Date.now();
      const batches: any[][] = [];
      for (let i = 0; i < gaps.length; i += BATCH_SIZE) batches.push(gaps.slice(i, i + BATCH_SIZE));
      if (batches.length === 0) batches.push([]);

      const resumed = ctx?.checkpoint?.partials as any[][] | undefined;
      const partials: any[][] = Array.isArray(resumed) ? [...resumed] : [];
      let totalInputTokens = ctx?.checkpoint?.totalInputTokens ?? 0;
      let maxBatchOutputTokens = ctx?.checkpoint?.maxBatchOutputTokens ?? 0;
      let promptCharsSum = ctx?.checkpoint?.promptCharsSum ?? 0;

      for (let b = partials.length; b < batches.length; b++) {
        if (Date.now() - stageT0 + CALL_BUDGET_MS > HARD_CEILING_MS) {
          throw { reason: 'generation_timeout', message: `Stage-level deadline reached after ${b}/${batches.length} gap batches -- bailing before the platform's hard kill so this can be retried cleanly (${b} batches already checkpointed).` };
        }
        const batchGaps = batches[b];
        const systemPrompt = buildStageSystemPrompt({
          objective: `For ONLY the specific documentation gaps listed below (batch ${b + 1} of ${batches.length}), draft the remediation scaffold -- a documentation template that would close that gap. Other batches handle the remaining gaps separately.`,
          fields: ['remediationScaffold_list'],
          constraints: [
            'remediationScaffold_list entries are documentation SCAFFOLDS with bracketed blanks only ([reference], [name], [date]), never finished prose with invented specifics. A signatory is a required ROLE, never an invented name.',
            'One remediationScaffold_list entry per gap listed below -- no more, no fewer.',
            ...constraintsFor(['remediationScaffold_list']),
          ],
          acceptanceCriteria: [],
        });
        const userPrompt = `${stageContextBlock(input)}\n\nGaps in THIS batch only (${batchGaps.length} of ${gaps.length} total):\n${JSON.stringify(batchGaps)}\n\nOutput ONLY a JSON object with exactly this key: remediationScaffold_list. Do not include any other keys. No prose outside the JSON.`;
        promptCharsSum += systemPrompt.length + userPrompt.length;

        const gen = await callClaude(systemPrompt, userPrompt, CALL_BUDGET_MS, AI_STAGE_BUDGET.maxCompletionTokens);
        ctx.recordCall(b + 1, gen, AI_STAGE_BUDGET.maxCompletionTokens);
        if (!gen.ok) throw { reason: gen.reason, httpStatus: (gen as any).httpStatus, retryAfterMs: (gen as any).retryAfterMs, message: `Gap batch ${b + 1}/${batches.length} failed: ${gen.message} (${partials.length} batches already checkpointed)` };
        totalInputTokens += gen.tokens.input ?? 0;
        maxBatchOutputTokens = Math.max(maxBatchOutputTokens, gen.tokens.output ?? 0);
        const { parsed, error } = parseJsonSubset(gen.text, ['remediationScaffold_list']);
        if (error) throw { reason: 'invalid_json_output', message: `Gap batch ${b + 1}/${batches.length} failed: ${error} (${partials.length} batches already checkpointed)` };
        const items: any[] = Array.isArray(parsed.remediationScaffold_list) ? parsed.remediationScaffold_list : [];
        validateFieldItems('remediationScaffold_list', items, `Gap batch ${b + 1}/${batches.length} (${partials.length} batches already checkpointed)`);
        partials.push(items);

        await ctx.saveCheckpoint({ partials, totalInputTokens, maxBatchOutputTokens, promptCharsSum });
      }

      const merged = partials.flat();
      const seen = new Set<string>();
      const remediationScaffold_list = merged.filter((entry: any) => {
        const key = JSON.stringify(entry);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const mapReduceMeta = {
        gapCount: gaps.length,
        batchCount: batches.length,
        batchSize: BATCH_SIZE,
        outputItemCount: remediationScaffold_list.length,
        duplicatesRemoved: merged.length - remediationScaffold_list.length,
        omittedCount: gaps.length - remediationScaffold_list.length,
      };
      if (mapReduceMeta.omittedCount !== 0) {
        throw { reason: 'remediation_scaffold_coverage_mismatch', message: `Expected ${gaps.length} remediationScaffold_list entries (one per gap), got ${remediationScaffold_list.length}.` };
      }

      return {
        fields: { remediationScaffold_list, mapReduceMeta },
        tokens: { input: totalInputTokens, output: maxBatchOutputTokens },
        promptChars: promptCharsSum,
      };
  }},

  { stage: 12, name: 'deterministic_assembly', kind: 'code', run: async (_input, prior) => {
      const s5a = { ...prior[5].fields, ...prior[6].fields };
      if (!Array.isArray(s5a.criticalGapsRanked_list) || typeof s5a.defensibilityRating !== 'string') {
        throw { reason: 'stage11_structural_inputs_missing', message: 'criticalGapsRanked_list or defensibilityRating missing from Stage 5/6 output -- cannot perform structural regrouping.' };
      }
      const executiveBriefBreakdown_list = s5a.criticalGapsRanked_list.map((gap: any) => ({
        gap,
        defensibilityRating: s5a.defensibilityRating,
      }));
      return { fields: { executiveBriefBreakdown_list } };
  }},

  { stage: 13, name: 'executive_brief', kind: 'ai', run: async (_input, prior, ctx) => {
      const context = { ...prior[4].fields, ...prior[5].fields, ...prior[6].fields, ...prior[7].fields, ...prior[8].fields, ...prior[9].fields, ...prior[10].fields, ...prior[11].fields, ...prior[12].fields };
      const systemPrompt = buildStageSystemPrompt({
        objective: 'Write a short executive brief summarizing the completed IRR analysis for a QA leader.',
        fields: ['executiveBrief'],
        constraints: ['2-3 sentences. No jargon a QA leader would need explained.', ...constraintsFor(['executiveBrief'])],
        acceptanceCriteria: [],
      });
      const userPrompt = `Completed IRR analysis:\n${JSON.stringify(context)}\n\nOutput ONLY {"executiveBrief": "..."}. No prose outside the JSON.`;
      const gen = await callClaude(systemPrompt, userPrompt, 30_000, 500);
      ctx.recordCall(1, gen, 500);
      if (!gen.ok) throw { reason: gen.reason, httpStatus: (gen as any).httpStatus, retryAfterMs: (gen as any).retryAfterMs, message: gen.message };
      const { parsed, error } = parseJsonSubset(gen.text, ['executiveBrief']);
      if (error) throw { reason: 'invalid_json_output', message: error };
      return { fields: parsed, tokens: gen.tokens, promptChars: systemPrompt.length + userPrompt.length };
  }},

  { stage: 14, name: 'schema_validation', kind: 'code', run: async (_input, prior) => {
      const { diagnostics: _drop5, ...stage5Fields } = prior[5].fields;
      const { diagnostics: _drop6, ...stage6Fields } = prior[6].fields;
      const { mapReduceMeta: _drop7, ...stage7Fields } = prior[7].fields;
      const { mapReduceMeta: _drop8, ...stage8Fields } = prior[8].fields;
      const { mapReduceMeta: _drop9, ...stage9Fields } = prior[9].fields;
      const { mapReduceMeta: _drop10, ...stage10Fields } = prior[10].fields;
      const { mapReduceMeta: _drop11, ...stage11Fields } = prior[11].fields;
      const structuredResponse = { ...prior[4].fields, ...stage5Fields, ...stage6Fields, ...stage7Fields, ...stage8Fields, ...stage9Fields, ...stage10Fields, ...stage11Fields, ...prior[12].fields, ...prior[13].fields };
      const runtimeManifest = { runtimeVersion: '3.7.0-staged-split7', runtimeAdapter: 'claude', schemaValidation: 'passed' };
      const res = await callJson(`${FN}/validate-editorial-output`, {
        artifact: { structuredResponse },
        executionSpecification: prior[2].executionSpecification,
        promptPackage: prior[3].promptPackage,
        runtimeManifest,
        skipEditorialReview: true,
      }, 8000);
      if (res?.terminalState !== 'PASS') throw { reason: 'structural_validation_failed', message: JSON.stringify(res?.blockingReasons ?? res) };
      return { fields: { structuredResponse, terminalState: res.terminalState } };
  }},

  { stage: 15, name: 'final_assembly', kind: 'code', run: async (input, prior) => {
      const r = prior[14].fields.structuredResponse;
      return {
        fields: {
          status: 'completed',
          artifactType: 'inspection_response_record',
          artifact: { ...r, decisionOwner: input.decisionOwner, authorizationTimestamp: input.authorizationDate },
          provenance: { contractId: prior[1].contract.contractId, architectureVersion: '3.7.0-staged-split7' },
        },
      };
  }},
];


// ---------- Orchestrator ----------
async function stallReclaim() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await sbRest(`irr_jobs?status=eq.running&updated_at=lt.${cutoff}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'failed', error_json: { stage: 'stalled', message: 'No stage progress for 10 minutes -- reclaimed.' }, updated_at: new Date().toISOString() }),
  });
}

async function runStage(jobId: string, def: typeof STAGES[number], inputPayload: any, prior: Record<number, any>, nextStage: number, attempt: number, maxAttempts: number, existingCheckpoint: any) {
  const t0 = Date.now();
  const ctx: StageCtx = {
    checkpoint: existingCheckpoint,
    telemetry: null,
    saveCheckpoint: async (data: any) => {
      await sbRest(`irr_stage_runs?job_id=eq.${jobId}&stage=eq.${nextStage}`, {
        method: 'PATCH',
        body: JSON.stringify({ checkpoint: data, updated_at: new Date().toISOString() }),
      });
    },
    recordCall: (batchNumber: number, gen: any, configuredMaxOutputTokens: number) => {
      ctx.telemetry = {
        batchNumber,
        promptTokens: gen?.tokens?.input ?? null,
        completionTokens: gen?.tokens?.output ?? null,
        stopReason: gen?.stopReason ?? null,
        outputCharCount: gen?.ok ? (gen.text?.length ?? null) : null,
        configuredMaxOutputTokens,
      };
    },
  };
  try {
    const output = await def.run(inputPayload, prior, ctx);
    const durationMs = Date.now() - t0;
    const withinBudget = def.kind === 'ai' ? checkBudget(Object.keys(output?.fields ?? {}).length, output?.tokens, durationMs) : null;
    await sbRest(`irr_stage_runs?job_id=eq.${jobId}&stage=eq.${nextStage}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'completed',
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        output_json: output,
        prompt_tokens: output?.tokens?.input ?? ctx.telemetry?.promptTokens ?? null,
        completion_tokens: output?.tokens?.output ?? ctx.telemetry?.completionTokens ?? null,
        within_budget: withinBudget,
        stop_reason: ctx.telemetry?.stopReason ?? null,
        batch_number: ctx.telemetry?.batchNumber ?? null,
        configured_max_output_tokens: ctx.telemetry?.configuredMaxOutputTokens ?? null,
        output_char_count: ctx.telemetry?.outputCharCount ?? null,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (err: any) {
    // Central classification (M7A-03): the resilience evaluator is now the single authority for
    // WHICH reasons are retryable, replacing the old inline `err.retryable`. It also subclassifies
    // provider errors by HTTP status (429 -> rate_limit, 401/403 -> authentication_error). The
    // engine keeps its EXISTING max_attempts as the retry COUNT ceiling — per-category ceilings
    // and delay-honoring are NOT adopted here (D-2(a): delayMs is recorded, not enforced), so
    // retry counts are unchanged. "Retryable in principle" ignores the ceiling (evaluate at attempt 1).
    const decision = decideFailure(err?.reason ?? 'unknown', attempt, maxAttempts, { httpStatus: err?.httpStatus, retryAfterMs: err?.retryAfterMs, jitterKey: `${jobId}:${nextStage}` });
    const canRetry = decision.action === 'retry';
    const errorReason = decision.reason_normalized;   // normalized: api_error+429 -> rate_limit, +401 -> authentication_error
    const errorCategory = decision.category;
    const telemetryFields = {
      stop_reason: ctx.telemetry?.stopReason ?? null,
      batch_number: ctx.telemetry?.batchNumber ?? null,
      configured_max_output_tokens: ctx.telemetry?.configuredMaxOutputTokens ?? null,
      output_char_count: ctx.telemetry?.outputCharCount ?? null,
      prompt_tokens: ctx.telemetry?.promptTokens ?? null,
      completion_tokens: ctx.telemetry?.completionTokens ?? null,
    };
    if (canRetry) {
      await sbRest(`irr_stage_runs?job_id=eq.${jobId}&stage=eq.${nextStage}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'queued', classified_failure: errorReason, error_detail: { message: err.message, category: errorCategory, delay_ms: decision.delay_ms }, ...telemetryFields, updated_at: new Date().toISOString() }),
      });
      return;
    }
    await sbRest(`irr_stage_runs?job_id=eq.${jobId}&stage=eq.${nextStage}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'failed', completed_at: new Date().toISOString(), duration_ms: Date.now() - t0, classified_failure: errorReason, error_detail: { message: err.message, category: errorCategory, delay_ms: decision.delay_ms }, ...telemetryFields, updated_at: new Date().toISOString() }),
    });
    await sbRest(`irr_jobs?job_id=eq.${jobId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'failed', error_json: { stage: def.name, reason: errorReason, category: errorCategory, message: err.message }, updated_at: new Date().toISOString() }),
    });
  }
}

serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  await stallReclaim().catch((e) => console.error('stallReclaim failed', e.message));

  const claimed = await sbRest('rpc/claim_next_active_irr_job', { method: 'POST', body: '{}' });
  const job = Array.isArray(claimed) && claimed[0] ? claimed[0] : null;
  if (!job) return new Response(JSON.stringify({ status: 'idle' }), { status: 200 });

  const completedRuns: any[] = await sbRest(`irr_stage_runs?job_id=eq.${job.job_id}&status=eq.completed&order=stage.asc`) ?? [];
  const prior: Record<number, any> = {};
  for (const r of completedRuns) prior[r.stage] = r.output_json;
  const highestCompleted = completedRuns.length ? Math.max(...completedRuns.map((r) => r.stage)) : 0;
  const nextStage = highestCompleted + 1;

  if (nextStage > STAGES.length) {
    await sbRest(`irr_jobs?job_id=eq.${job.job_id}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed', result_json: prior[STAGES.length].fields, updated_at: new Date().toISOString() }) });
    return new Response(JSON.stringify({ status: 'job_completed', job_id: job.job_id }), { status: 200 });
  }

  const def = STAGES[nextStage - 1];
  const existingRun = (await sbRest(`irr_stage_runs?job_id=eq.${job.job_id}&stage=eq.${nextStage}`))?.[0];

  if (existingRun?.status === 'running' && existingRun.started_at) {
    const ageMs = Date.now() - new Date(existingRun.started_at).getTime();
    if (ageMs < 380_000) {
      return new Response(JSON.stringify({ status: 'stage_in_progress', job_id: job.job_id, stage: nextStage, age_ms: ageMs }), { status: 200 });
    }
    if ((existingRun.attempt ?? 0) >= (existingRun.max_attempts ?? 6)) {
      await sbRest(`irr_stage_runs?job_id=eq.${job.job_id}&stage=eq.${nextStage}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'failed', completed_at: new Date().toISOString(), classified_failure: 'platform_kill_exhausted_retries', error_detail: { message: `Stage was reclaimed as stale after exhausting ${existingRun.max_attempts} attempts -- almost certainly killed by the platform ceiling rather than failing cleanly.` }, updated_at: new Date().toISOString() }),
      });
      await sbRest(`irr_jobs?job_id=eq.${job.job_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'failed', error_json: { stage: def.name, reason: 'platform_kill_exhausted_retries', message: 'Stage exceeded max_attempts across stale reclaims.' }, updated_at: new Date().toISOString() }),
      });
      return new Response(JSON.stringify({ status: 'job_failed', job_id: job.job_id, stage: nextStage, reason: 'platform_kill_exhausted_retries' }), { status: 200 });
    }
  }

  const attempt = (existingRun?.attempt ?? 0) + 1;
  const maxAttempts = existingRun?.max_attempts ?? 6;

  await sbRest('irr_stage_runs?on_conflict=job_id,stage', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([{ job_id: job.job_id, stage: nextStage, stage_name: def.name, status: 'running', started_at: new Date().toISOString(), attempt, max_attempts: maxAttempts, updated_at: new Date().toISOString() }]),
  });

  // Detached execution, same pattern as irr-job-worker/runtime-worker.
  // @ts-ignore -- EdgeRuntime is a Supabase/Deno Deploy global, not in std types.
  EdgeRuntime.waitUntil(runStage(job.job_id, def, job.input_payload, prior, nextStage, attempt, maxAttempts, existingRun?.checkpoint ?? null));

  return new Response(JSON.stringify({ status: 'stage_processing', job_id: job.job_id, stage: nextStage, stage_name: def.name, attempt }), { status: 202 });
});
