import { PromptPackage } from './prompt-schema.ts';
import { CompletedArtifact, EditorialReview, EditorialFinding } from './types.ts';
import { REASONING_DIMENSION_PROMPT } from './reasoning-validator.ts';
import { EVIDENCE_DIMENSION_PROMPT } from './evidence-validator.ts';
import { buildNarrativeDimensionPrompt } from './narrative-validator.ts';
import { COMMERCIAL_DIMENSION_PROMPT } from './commercial-validator.ts';

const FORBIDDEN_VERDICT_WORDS = ['pass', 'fail', 'compliant', 'non-compliant', 'score', 'approved', 'rejected', '%'];

const SYSTEM_PROMPT = `You review one generated editorial artifact across four dimensions. You do not output a pass/fail verdict, a compliance claim, or a numeric score -- there is no field for one, and you must not describe your findings using words like "pass," "fail," "compliant," "score," or "approved" anywhere in your output. For each dimension, either state a specific finding with supporting evidence quoted or closely paraphrased from the artifact, a recommendation, and a confidence level -- or state plainly that you found nothing worth flagging on that dimension. Do not manufacture a finding to have something to say about every dimension.

Dimensions to evaluate:
1. ${REASONING_DIMENSION_PROMPT}
2. ${EVIDENCE_DIMENSION_PROMPT}
3. {{NARRATIVE_DIMENSION}}
4. ${COMMERCIAL_DIMENSION_PROMPT}

Return ONLY a JSON object of this exact shape, nothing else:
{"findings": [{"dimension": "reasoning|evidence|narrative|commercial", "severity": "low|medium|high", "question": "string", "supportingEvidence": "string", "recommendation": "string", "confidence": "low|medium|high"}]}`;

function extractJsonObject(text: string): unknown {
  const fenceStripped = text.replace(/```json|```/g, '').trim();
  const first = fenceStripped.indexOf('{');
  const last = fenceStripped.lastIndexOf('}');
  const clean = first !== -1 && last !== -1 && last > first ? fenceStripped.slice(first, last + 1) : fenceStripped;
  return JSON.parse(clean);
}

function containsForbiddenVerdictLanguage(text: string): string | null {
  const lower = text.toLowerCase();
  for (const word of FORBIDDEN_VERDICT_WORDS) { if (lower.includes(word)) return word; }
  return null;
}

export interface ReviewEngineResult { review: EditorialReview | null; error: string | null; }

export async function runEditorialReview(
  artifact: CompletedArtifact,
  pkg: PromptPackage,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<ReviewEngineResult> {
  const systemPrompt = SYSTEM_PROMPT.replace('{{NARRATIVE_DIMENSION}}', buildNarrativeDimensionPrompt(pkg.validationInstructions.narrativeCheck.expectedSequence));

  let response;
  try {
    response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1500, system: systemPrompt, messages: [{ role: 'user', content: `Artifact to review:\n${JSON.stringify(artifact.structuredResponse)}` }] }),
    });
  } catch (err) {
    return { review: null, error: `Editorial Review Engine network failure: ${(err as Error).message}` };
  }

  const data = await response.json();
  if (data.error) return { review: null, error: `Editorial Review Engine API error: ${data.error.message}` };

  const rawText = data?.content?.[0]?.text ?? '';

  const forbiddenWord = containsForbiddenVerdictLanguage(rawText);
  if (forbiddenWord) {
    return { review: null, error: `Editorial Review Engine output contained forbidden verdict language ("${forbiddenWord}"). Discarded rather than passed through.` };
  }

  let parsed: { findings?: EditorialFinding[] };
  try {
    parsed = extractJsonObject(rawText) as { findings?: EditorialFinding[] };
  } catch (err) {
    return { review: null, error: `Editorial Review Engine output was not valid JSON: ${(err as Error).message}` };
  }

  if (!Array.isArray(parsed.findings)) return { review: null, error: 'Editorial Review Engine output missing a findings array.' };

  return { review: { findings: parsed.findings }, error: null };
}
