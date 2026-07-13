// response-builder.ts

export interface CompletedInputs {
  contractId: string;
  artifact: { structuredResponse: Record<string, unknown> };
  executionSpecification: { compiler: { architectureVersion: string; checksum: string } };
  promptPackage: { manifest: { checksum: string } };
  runtimeManifest: { runtimeAdapter: string; executionStart: string };
  editorialReview: { findings: unknown[] } | null;
  reviewError: string | null;
  validationManifestChecksum: string;
}

export function buildCompletedResponse(input: CompletedInputs) {
  return {
    status: 'completed' as const,
    artifactType: 'executive_brief' as const,
    artifact: {
      title: input.artifact.structuredResponse.title,
      summary: input.artifact.structuredResponse.summary,
      sections: input.artifact.structuredResponse.sections_list,
    },
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
      runtimeId: `${input.runtimeManifest.runtimeAdapter}-${input.runtimeManifest.executionStart}`,
      validationId: input.validationManifestChecksum,
    },
  };
}
