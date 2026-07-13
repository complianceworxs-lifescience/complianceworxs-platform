import { ExecutiveBriefRequest } from './executive-brief-types.ts';

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

export function buildExecutiveBriefContract(input: ExecutiveBriefRequest) {
  const contractId = `EC-EXEC-BRIEF-${slugify(input.topic)}-${slugify(input.audience)}`;
  return {
    contractId,
    purpose: `Governs an executive brief on "${input.topic}" for ${input.audience}.`,
    audience: input.audience,
    commercialObjective: input.commercialObjective,
    requiredInputs: ['topic', 'audience', 'commercialObjective', 'sourceMaterial'],
    requiredOutputs: ['title', 'summary', 'sections_list'],
    narrativePattern: 'NP-003',
    reasoningRules: ['RG-001', 'RG-004', 'RG-005'],
    evidenceRules: ['ES-001', 'ES-003'],
    constraints: ['Must not name a specific real company in public-facing copy without sanitization.', 'No more than five sections.', `Source material to draw from: ${input.sourceMaterial}`],
    acceptanceCriteria: ['States the recommendation before background elaboration.', 'Contains exactly one primary recommendation.', 'Names the specific decision or gap the audience must act on.'],
    traceability: { inheritsFrom: ['Chapter 3', 'Chapter 5', 'Chapter 6'] },
    versionMetadata: { version: '1.0.0', status: 'approved', dependencies: ['Chapter 1', 'Chapter 7', 'Chapter 8'] },
  };
}
