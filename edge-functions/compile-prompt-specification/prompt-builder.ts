import { ExecutionSpecification } from './execution-schema.ts';
import { PromptSpecification, TargetRuntime, ExecutionConstraints } from './prompt-schema.ts';
import { buildContextRequirements } from './context-builder.ts';

const RUNTIME_FRAMING: Record<TargetRuntime, { roleLabel: string; instructionOpener: string }> = {
  claude: { roleLabel: 'System', instructionOpener: 'You will produce content that satisfies the following execution profile.' },
  gpt: { roleLabel: 'Developer', instructionOpener: 'The assistant must produce content that satisfies the following execution profile.' },
  gemini: { roleLabel: 'System Instruction', instructionOpener: 'Generate content that satisfies the following execution profile.' },
};

export function buildSystemPrompt(es: ExecutionSpecification, targetRuntime: TargetRuntime): string {
  const framing = RUNTIME_FRAMING[targetRuntime];
  const stageList = es.narrativeProfile.expandedSequence.join(' -> ');
  return [
    `${framing.roleLabel}: ${framing.instructionOpener}`,
    `Narrative sequence (follow in order, do not reorder or omit a stage): ${stageList}.`,
    `Reasoning rules that govern this content: ${[...es.reasoningProfile.grammar, ...es.reasoningProfile.standards].join(', ') || 'none declared'}.`,
    `Evidence rules that govern this content: ${es.evidenceProfile.join(', ') || 'none declared'}.`,
    es.constraints.length > 0 ? `Constraints: ${es.constraints.join(' | ')}` : 'Constraints: none declared.',
    // Previously this only named the required fields and said "nothing else" about
    // the response as a whole -- it never explicitly forbade ADDITIONAL field names
    // inside the JSON object. EC-05 (Milestone 6) showed the model adding a field
    // ("executiveRiskStatement") that was never in the contract; the validator
    // correctly rejected it (D3, working as designed), but nothing at generation
    // time told the model the field set was exhaustive, not a floor. Fixed here,
    // at the source of the instruction, rather than only catching it downstream.
    `Required output fields (exhaustive -- this is the complete set, not a minimum): ${es.requiredOutputs.join(', ')}. Return exactly one JSON object containing only these fields, using these exact field names. Do not add, rename, split, or substitute any field. Do not include any field not in this list, however useful it may seem. No commentary, explanation, or text outside the JSON object.`,
  ].join('\n');
}

export function buildUserPromptTemplate(es: ExecutionSpecification): string {
  const placeholders = es.requiredInputs.map((input) => `${input}: {{${input}}}`);
  return placeholders.join('\n');
}

export function buildExecutionConstraints(es: ExecutionSpecification): ExecutionConstraints {
  return {
    maxSections: es.narrativeProfile.expandedSequence.length,
    requiredEvidenceCount: Math.max(es.evidenceProfile.length, 1),
    outputFormat: 'json',
    traceabilityRequired: true,
  };
}

export function buildPromptSpecification(es: ExecutionSpecification, targetRuntime: TargetRuntime): PromptSpecification {
  return {
    id: `PS-${es.id}-${targetRuntime}`,
    sourceExecutionSpecification: es.id,
    targetRuntime,
    systemPrompt: buildSystemPrompt(es, targetRuntime),
    userPromptTemplate: buildUserPromptTemplate(es),
    contextRequirements: buildContextRequirements(es),
    recoveryInstructions: {
      onInvalidOutput: 'Re-request with an explicit reminder of the required JSON schema and a list of which fields were missing or malformed.',
      onMissingField: 'Re-request, naming the specific missing field(s) and instructing the model to return the complete object again, not a patch.',
      maxRetries: 1,
    },
  };
}