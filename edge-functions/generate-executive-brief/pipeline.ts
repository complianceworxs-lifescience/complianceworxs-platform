// pipeline.ts

import { ExecutiveBriefRequest, PipelineResult, PipelineUrls } from './types.ts';
import { buildExecutiveBriefContract } from './contract-builder.ts';
import { buildCompletedResponse } from './response-builder.ts';

async function callJson(url: string, body: unknown, fetchImpl: typeof fetch): Promise<{ status: number; body: any }> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { status: response.status, body: json };
}

export async function runExecutiveBriefPipeline(
  input: ExecutiveBriefRequest,
  urls: PipelineUrls,
  fetchImpl: typeof fetch,
): Promise<PipelineResult> {
  const contract = buildExecutiveBriefContract(input);

  const validation = await callJson(urls.validateContract, contract, fetchImpl);
  if (validation.body.status !== 'valid') {
    return { status: 'rejected', stage: 'contract_invalid', issues: (validation.body.issues ?? []).map((i: any) => ({ field: i.field, message: i.message })) };
  }

  const compiled = await callJson(urls.compileContract, contract, fetchImpl);
  if (compiled.body.status !== 'compiled') {
    return { status: 'rejected', stage: 'execution_compile_failed', issues: (compiled.body.issues ?? []).map((i: any) => ({ field: i.field, message: i.message })) };
  }
  const executionSpecification = compiled.body.executionSpecification;

  const promptResult = await callJson(urls.compilePrompt, { executionSpecification, targetRuntime: 'claude' }, fetchImpl);
  if (promptResult.body.status !== 'compiled') {
    return { status: 'rejected', stage: 'prompt_package_invalid', issues: (promptResult.body.issues ?? []).map((i: any) => ({ field: i.field, message: i.message })) };
  }
  const promptPackage = promptResult.body.promptPackage;

  const runtimeResult = await callJson(urls.runtime, {
    promptPackage,
    userVariables: { topic: input.topic, audience: input.audience, commercialObjective: input.commercialObjective, sourceMaterial: input.sourceMaterial },
  }, fetchImpl);
  if (runtimeResult.body.status !== 'executed') {
    return { status: 'rejected', stage: 'runtime_failed', issues: (runtimeResult.body.issues ?? []).map((i: any) => ({ field: i.field, message: i.message })) };
  }
  const artifact = runtimeResult.body.artifact;
  const runtimeManifest = runtimeResult.body.runtimeManifest;

  const validationResult = await callJson(urls.validateOutput, { artifact, executionSpecification, promptPackage, runtimeManifest }, fetchImpl);
  const deterministic = validationResult.body.deterministic;
  if (!deterministic || deterministic.status !== 'pass') {
    return {
      status: 'rejected',
      stage: 'structural_validation_failed',
      issues: (deterministic?.checks ?? []).filter((c: any) => c.result === 'fail').map((c: any) => ({ field: c.id, message: c.detail ?? c.description })),
    };
  }

  return buildCompletedResponse({
    contractId: contract.contractId,
    artifact,
    executionSpecification,
    promptPackage,
    runtimeManifest,
    editorialReview: validationResult.body.editorialReview,
    reviewError: validationResult.body.reviewError,
    validationManifestChecksum: validationResult.body.manifest.checksum,
  });
}
