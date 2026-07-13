import { ExecutionSpecification } from './execution-schema.ts';
import { PromptPackage } from './prompt-schema.ts';
import { CompletedArtifact, RuntimeManifestInput, EditorialAssuranceReport, EditorialReview, DeterministicResult } from './types.ts';
import { runDeterministicValidation, detectSpecificationError } from './structural-validator.ts';
import { runEditorialReview } from './review-engine.ts';
import { buildValidationManifest } from './manifest.ts';

export type TerminalState = 'PASS' | 'REWRITE_REQUIRED' | 'REJECT' | 'SPECIFICATION_ERROR';

const REJECT_CHECK_IDS = new Set([
  'D1-runtime-schema-report',
  'D2-prompt-package-checksum',
  'D6-runtime-package-consistency',
]);

const BLOCKING_REVIEW_DIMENSIONS = new Set(['reasoning', 'evidence', 'narrative']);

export function computeTerminalState(
  specificationIssues: string[],
  deterministic: DeterministicResult,
  editorialReview: EditorialReview | null,
): { terminalState: TerminalState; blockingReasons: string[] } {
  if (specificationIssues.length > 0) {
    return { terminalState: 'SPECIFICATION_ERROR', blockingReasons: specificationIssues };
  }

  const failedChecks = deterministic.checks.filter((c) => c.result === 'fail');
  const rejectChecks = failedChecks.filter((c) => REJECT_CHECK_IDS.has(c.id));
  if (rejectChecks.length > 0) {
    return {
      terminalState: 'REJECT',
      blockingReasons: rejectChecks.map((c) => `${c.id}: ${c.detail ?? c.description}`),
    };
  }

  if (failedChecks.length > 0) {
    return {
      terminalState: 'REWRITE_REQUIRED',
      blockingReasons: failedChecks.map((c) => `${c.id}: ${c.detail ?? c.description}`),
    };
  }

  const blockingFindings = (editorialReview?.findings ?? []).filter(
    (f) => f.severity === 'high' && BLOCKING_REVIEW_DIMENSIONS.has(f.dimension),
  );
  if (blockingFindings.length > 0) {
    return {
      terminalState: 'REWRITE_REQUIRED',
      blockingReasons: blockingFindings.map((f) => `${f.dimension} (high): ${f.question}`),
    };
  }

  return { terminalState: 'PASS', blockingReasons: [] };
}

export async function runEditorialAssurance(
  artifact: CompletedArtifact,
  es: ExecutionSpecification,
  pkg: PromptPackage,
  runtimeManifest: RuntimeManifestInput,
  reviewApiKey: string | null,
  fetchImpl: typeof fetch,
): Promise<EditorialAssuranceReport & { reviewError: string | null; terminalState: TerminalState; blockingReasons: string[] }> {
  const specificationIssues = detectSpecificationError(es, pkg, artifact);

  const deterministic = runDeterministicValidation(artifact, es, pkg, runtimeManifest);

  let editorialReview: EditorialReview | null = null;
  let reviewError: string | null = null;

  if (specificationIssues.length === 0) {
    if (reviewApiKey) {
      const result = await runEditorialReview(artifact, pkg, reviewApiKey, fetchImpl);
      editorialReview = result.review;
      reviewError = result.error;
    } else {
      reviewError = 'No API key provided -- Editorial Review Engine skipped. Deterministic result is unaffected.';
    }
  } else {
    reviewError = 'Editorial Review Engine skipped -- specification error detected before generation could be meaningfully evaluated.';
  }

  const { terminalState, blockingReasons } = computeTerminalState(specificationIssues, deterministic, editorialReview);

  const manifest = buildValidationManifest(es.id, pkg.manifest.checksum, deterministic, editorialReview);

  return { deterministic, editorialReview, manifest, reviewError, terminalState, blockingReasons };
}
