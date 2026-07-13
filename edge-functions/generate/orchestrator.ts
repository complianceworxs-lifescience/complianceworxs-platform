import { OrchestratorRequest, OrchestratorResult, OrchestratorUrls, StageLogEntry, PipelineState } from './types.ts';
import { buildContractForRequest } from './dispatcher.ts';
import { startStage, recordStage } from './logger.ts';
import { buildPipelineManifest } from './manifest.ts';
import { buildCompletedOrchestratorResponse } from './response.ts';
import { nextState } from './state-machine.ts';

async function callJson(url: string, body: unknown, fetchImpl: typeof fetch): Promise<{ status: number; body: any }> {
  const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await response.json();
  return { status: response.status, body: json };
}

function toIssues(list: any[] | undefined): { field?: string; message: string }[] {
  return (list ?? []).map((i: any) => ({ field: i.field, message: i.message ?? i.detail ?? i.description ?? 'Unknown issue.' }));
}

export async function runOrchestrator(
  request: OrchestratorRequest,
  urls: OrchestratorUrls,
  fetchImpl: typeof fetch,
): Promise<OrchestratorResult> {
  const history: StageLogEntry[] = [];
  let state: PipelineState = 'RECEIVED';

  const built = buildContractForRequest(request);
  if ('error' in built) {
    return { status: 'failed', stage: 'unsupported_asset_type', issues: [{ message: built.error }], executionHistory: history };
  }
  const contract = built.contract;

  let t = startStage();
  const validation = await callJson(urls.validateContract, contract, fetchImpl);
  if (validation.body.status !== 'valid') {
    history.push(recordStage('validate-editorial-contract', state, 'failed', t, contract, null));
    return { status: 'failed', stage: 'contract_invalid', issues: toIssues(validation.body.issues), executionHistory: history };
  }
  history.push(recordStage('validate-editorial-contract', state, 'ok', t, contract, validation.body));
  state = nextState(state);

  t = startStage();
  const compiled = await callJson(urls.compileContract, contract, fetchImpl);
  if (compiled.body.status !== 'compiled') {
    history.push(recordStage('compile-editorial-contract', state, 'failed', t, contract, null));
    return { status: 'failed', stage: 'execution_compile_failed', issues: toIssues(compiled.body.issues), executionHistory: history };
  }
  history.push(recordStage('compile-editorial-contract', state, 'ok', t, contract, compiled.body));
  const executionSpecification = compiled.body.executionSpecification;
  state = nextState(state);

  t = startStage();
  const promptInput = { executionSpecification, targetRuntime: 'claude' };
  const promptResult = await callJson(urls.compilePrompt, promptInput, fetchImpl);
  if (promptResult.body.status !== 'compiled') {
    history.push(recordStage('compile-prompt-specification', state, 'failed', t, promptInput, null));
    return { status: 'failed', stage: 'prompt_package_invalid', issues: toIssues(promptResult.body.issues), executionHistory: history };
  }
  history.push(recordStage('compile-prompt-specification', state, 'ok', t, promptInput, promptResult.body));
  const promptPackage = promptResult.body.promptPackage;
  state = nextState(state);

  t = startStage();
  const runtimeInput = {
    promptPackage,
    userVariables: { topic: request.topic, audience: request.audience, commercialObjective: request.commercialObjective, sourceMaterial: request.sourceMaterial },
  };
  const runtimeResult = await callJson(urls.runtime, runtimeInput, fetchImpl);
  if (runtimeResult.body.status !== 'executed') {
    history.push(recordStage('runtime', state, 'failed', t, runtimeInput, null));
    return { status: 'failed', stage: 'runtime_failed', issues: toIssues(runtimeResult.body.issues), executionHistory: history };
  }
  history.push(recordStage('runtime', state, 'ok', t, runtimeInput, runtimeResult.body));
  const artifact = runtimeResult.body.artifact;
  const runtimeManifest = runtimeResult.body.runtimeManifest;
  state = nextState(state);

  t = startStage();
  const validateInput = { artifact, executionSpecification, promptPackage, runtimeManifest };
  const validationResult = await callJson(urls.validateOutput, validateInput, fetchImpl);
  const deterministic = validationResult.body.deterministic;
  if (!deterministic || deterministic.status !== 'pass') {
    history.push(recordStage('validate-editorial-output', state, 'failed', t, validateInput, null));
    return {
      status: 'failed',
      stage: 'structural_validation_failed',
      issues: (deterministic?.checks ?? []).filter((c: any) => c.result === 'fail').map((c: any) => ({ field: c.id, message: c.detail ?? c.description })),
      executionHistory: history,
    };
  }
  history.push(recordStage('validate-editorial-output', state, 'ok', t, validateInput, validationResult.body));
  state = nextState(state);
  state = nextState(state);

  const pipelineManifest = buildPipelineManifest({
    executionSpecification,
    promptPackage,
    runtimeManifest,
    validationManifest: validationResult.body.manifest,
    contractId: (contract as any).contractId,
  });

  return buildCompletedOrchestratorResponse({
    assetType: request.assetType,
    structuredResponse: artifact.structuredResponse,
    editorialReview: validationResult.body.editorialReview,
    reviewError: validationResult.body.reviewError,
    pipelineManifest,
    executionHistory: history,
  });
}
