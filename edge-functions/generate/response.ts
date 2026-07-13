import { PipelineManifest, StageLogEntry } from './types.ts';

export function buildCompletedOrchestratorResponse(args: {
  assetType: string;
  structuredResponse: Record<string, unknown>;
  editorialReview: { findings: unknown[] } | null;
  reviewError: string | null;
  pipelineManifest: PipelineManifest;
  executionHistory: StageLogEntry[];
}) {
  const { title, summary, sections_list, ...rest } = args.structuredResponse as Record<string, unknown> & { sections_list?: unknown };

  return {
    status: 'completed' as const,
    assetType: args.assetType,
    artifact: { title, summary, sections: sections_list, ...rest },
    structuralValidation: { status: 'pass' as const, issues: [] as never[] },
    editorialReview: {
      findings: args.editorialReview?.findings ?? [],
      limitations: args.reviewError ? [args.reviewError] : [],
    },
    pipelineManifest: args.pipelineManifest,
    executionHistory: args.executionHistory,
  };
}
