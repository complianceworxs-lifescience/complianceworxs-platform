import { Industry } from './types.ts';

const RECONSTRUCTION_PREVENTION_STATEMENT =
  'This record was generated to document the authorization rationale contemporaneously with the operational decision in order to prevent post-inspection reconstruction of release justification.';

const INDUSTRIES_WITH_RECONSTRUCTION_STATEMENT: Industry[] = ['pharma', '503b'];

export interface CompletedInputs {
  contractId: string;
  decisionOwner: string;
  authorizationDate: string;
  industry: Industry;
  artifact: { structuredResponse: Record<string, unknown> };
  executionSpecification: { compiler: { architectureVersion: string; checksum: string } };
  promptPackage: { manifest: { checksum: string } };
  runtimeManifest: { runtimeAdapter: string; latencyMs: number };
  editorialReview: { findings: unknown[] } | null;
  reviewError: string | null;
  validationManifestChecksum: string;
}

export function buildCompletedResponse(input: CompletedInputs) {
  const r = input.artifact.structuredResponse;

  const artifact = {
    investigatorQuestion: r.investigatorQuestion,
    authorizationSummary: r.authorizationSummary,
    evidenceReviewed: r.evidenceReviewed_list,
    riskEvaluation: r.riskEvaluation,
    alternativesConsidered: r.alternativesConsidered,
    authorizationRationale: r.authorizationRationale,
    regulatoryAlignment: r.regulatoryAlignment,
    residualExposureStatement: r.residualExposureStatement,
    knownLimitations: r.knownLimitations,
    gapFlags: r.gapFlags_list,
    criticalGapsRanked: r.criticalGapsRanked_list,
    defensibilityRating: r.defensibilityRating,
    executiveBrief: r.executiveBrief,
    executiveBriefBreakdown: r.executiveBriefBreakdown_list,
    evidenceMatrix: r.evidenceMatrix_list,
    evidenceTraceability: r.evidenceTraceability_list,
    claimStatus: r.claimStatus_list,
    unsupportedClaims: r.unsupportedClaims_list,
    inspectorChallenge: r.inspectorChallenge_list,
    remediationScaffold: r.remediationScaffold_list,
    decisionOwner: input.decisionOwner,
    authorizationTimestamp: input.authorizationDate,
    reconstructionPreventionStatement: INDUSTRIES_WITH_RECONSTRUCTION_STATEMENT.includes(input.industry)
      ? RECONSTRUCTION_PREVENTION_STATEMENT
      : null,
  };

  return {
    status: 'completed' as const,
    artifactType: 'inspection_response_record' as const,
    artifact,
    structuralValidation: { status: 'pass' as const, issues: [] as never[] },
    editorialReview: {
      findings: input.editorialReview?.findings ?? [],
      limitations: input.reviewError ? [input.reviewError] : [],
    },
    provenance: {
      architectureVersion: input.executionSpecification.compiler.architectureVersion,
      contractId: input.contractId,
      executionSpecChecksum: input.executionSpecification.compiler.checksum,
      promptPackageChecksum: input.promptPackage.manifest.checksum,
      runtimeId: `${input.runtimeManifest.runtimeAdapter}-${input.runtimeManifest.latencyMs}ms`,
      validationId: input.validationManifestChecksum,
    },
  };
}
