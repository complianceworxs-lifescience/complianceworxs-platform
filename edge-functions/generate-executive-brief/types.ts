// types.ts

export interface ExecutiveBriefRequest {
  topic: string;
  audience: string;
  commercialObjective: string;
  sourceMaterial: string;
  assetType: 'executive_brief';
}

export type PipelineFailureStage =
  | 'contract_invalid'
  | 'execution_compile_failed'
  | 'prompt_package_invalid'
  | 'runtime_failed'
  | 'structural_validation_failed';

export interface PipelineIssue {
  field?: string;
  message: string;
}

export type PipelineResult =
  | {
      status: 'completed';
      artifactType: 'executive_brief';
      artifact: { title: unknown; summary: unknown; sections: unknown };
      structuralValidation: { status: 'pass'; issues: never[] };
      editorialReview: { findings: unknown[]; limitations: string[] };
      provenance: {
        architectureVersion: string;
        contractId: string;
        executionSpecChecksum: string;
        promptPackageChecksum: string;
        runtimeId: string;
        validationId: string;
      };
    }
  | { status: 'rejected'; stage: PipelineFailureStage; issues: PipelineIssue[] };

export interface PipelineUrls {
  validateContract: string;
  compileContract: string;
  compilePrompt: string;
  runtime: string;
  validateOutput: string;
}
