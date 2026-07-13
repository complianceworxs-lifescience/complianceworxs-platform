import { ReviewMetadata } from './types.ts';

export const REVIEW_TYPE = 'batch_review_by_exception' as const;
export const REVIEW_VERSION = '1.0.0';

export interface CompletedInputs {
  contractId: string;
  decisionDomain: string;
  submittedDocumentCount: number;
  artifact: { structuredResponse: Record<string, unknown> };
  executionSpecification: { compiler: { architectureVersion: string; checksum: string } };
  promptPackage: { manifest: { checksum: string } };
  runtimeManifest: { runtimeAdapter: string; executionStart: string };
  editorialReview: { findings: unknown[] } | null;
  reviewError: string | null;
  validationManifestChecksum: string;
}

export function buildCompletedResponse(input: CompletedInputs) {
  const r = input.artifact.structuredResponse;
  const findings = Array.isArray(r.findings_list) ? r.findings_list : [];

  const reviewMetadata: ReviewMetadata = {
    reviewType: REVIEW_TYPE,
    reviewVersion: REVIEW_VERSION,
    reviewTimestamp: new Date().toISOString(),
    decisionDomain: input.decisionDomain,
    submittedDocumentCount: input.submittedDocumentCount,
    findingCount: findings.length,
  };

  return {
    status: 'completed' as const,
    artifactType: 'batch_review' as const,
    artifact: {
      reviewSummary: r.reviewSummary,
      findings,
      evidenceNotLocated: r.evidenceNotLocated_list,
      recommendedActions: r.recommendedActions_list,
      irrReferences: r.irrReferences_list,
      reviewMetadata,
    },
    structuralValidation: { status: 'pass' as const, issues: [] as never[] },
    editorialReview: { findings: input.editorialReview?.findings ?? [], limitations: input.reviewError ? [input.reviewError] : [] },
    provenance: {
      architectureVersion: input.executionSpecification.compiler.architectureVersion,
      contractId: input.contractId,
      executionSpecChecksum: input.executionSpecification.compiler.checksum,
      promptPackageChecksum: input.promptPackage.manifest.checksum,
      runtimeId: `${input.runtimeManifest.runtimeAdapter}-${input.runtimeManifest.executionStart}`,
      validationId: input.validationManifestChecksum,
    },
  };
}
