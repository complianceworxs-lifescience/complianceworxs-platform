export function buildNarrativeDimensionPrompt(expectedSequence: string[]): string {
  return `Narrative: The artifact is required to follow this sequence: ${expectedSequence.join(' -> ')}. Evaluate whether the artifact's actual prose follows this sequence in substance (not merely in section headers), whether it pursues a single analytical objective rather than several competing ones, and whether narrative structure has been preserved without distorting the underlying reasoning.`;
}
