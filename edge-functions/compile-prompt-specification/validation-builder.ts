import { ExecutionSpecification } from './execution-schema.ts';
import { ValidationInstructions } from './prompt-schema.ts';

export const FORBIDDEN_TERMS = ['DDR', 'Decision Defense Record', 'decision defensibility', 'platform', 'authorization framework', 'AI', 'automation', 'leverage'];

export function buildValidationInstructions(es: ExecutionSpecification): ValidationInstructions {
  return {
    reasoningChecks: [...es.reasoningProfile.grammar, ...es.reasoningProfile.standards],
    evidenceChecks: [...es.evidenceProfile],
    narrativeCheck: { patternId: es.narrativeProfile.patternId, expectedSequence: [...es.narrativeProfile.expandedSequence] },
    forbiddenTerms: [...FORBIDDEN_TERMS],
  };
}
