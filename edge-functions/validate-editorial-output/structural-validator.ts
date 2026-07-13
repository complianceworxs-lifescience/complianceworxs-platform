import { ExecutionSpecification } from './execution-schema.ts';
import { PromptPackage } from './prompt-schema.ts';
import { CompletedArtifact, RuntimeManifestInput, DeterministicCheck, DeterministicResult } from './types.ts';
import { sha256 } from './checksum-util.ts';

function containsBannedLanguage(text: string): boolean {
  return /\y(DDR|Decision Defense Record|decision defensibility|authorization framework|leverage|automation)\y/i.test(text)
    || /\bplatform\b/i.test(text)
    || /\bAI\b/.test(text);
}

function verifyPackageChecksum(pkg: PromptPackage): boolean {
  const { manifest, ...packageWithoutManifest } = pkg;
  const { timestamp, checksum, ...manifestBase } = manifest;
  return sha256({ ...packageWithoutManifest, manifest: manifestBase }) === checksum;
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

// These three labels are the complete, exhaustive enum the Editorial
// Contract itself defines for claimStatus_list entries (see the
// contract-builder.ts constraint: 'classifies one specific factual claim...
// as exactly one of: "Claimed in rationale", "Supported by attached
// evidence", "Not traceable in record"'). Previously this validator only
// recognized two of the three -- a model correctly emitting the contract's
// own "Claimed in rationale" label was being rejected by a check that never
// accounted for a value its own contract requires. That was a validator
// bug, not a model/prompt defect: the fix is here, not in the prompt.
const SUPPORTED_LABELS = ['supported by attached evidence'];
const UNSUPPORTED_LABELS = ['not traceable in record', 'unsupported', 'missing', 'unresolved'];
const CLAIMED_ONLY_LABELS = ['claimed in rationale'];

function checkClaimEvidenceTraceability(artifact: CompletedArtifact): DeterministicCheck {
  const response = artifact?.structuredResponse ?? {};
  const claims = (response as Record<string, unknown>)['claimStatus_list'];
  const evidence = (response as Record<string, unknown>)['evidenceReviewed_list'];

  if (!Array.isArray(claims)) {
    return {
      id: 'D7-claim-evidence-traceability',
      description: 'Every claim in claimStatus_list resolves to evidenceReviewed_list or is explicitly labeled unsupported.',
      result: 'fail',
      detail: 'claimStatus_list is missing or not an array -- traceability cannot be verified.',
    };
  }

  const hasEvidence = Array.isArray(evidence) && evidence.length > 0;
  const problems: string[] = [];

  claims.forEach((entry: unknown, i: number) => {
    const status = typeof entry === 'object' && entry !== null
      ? String((entry as Record<string, unknown>).status ?? '').trim().toLowerCase()
      : '';

    if (!status) {
      problems.push(`claim[${i}] has no status field -- a claim cannot be left silently unlabeled.`);
      return;
    }

    const isSupported = SUPPORTED_LABELS.some((l) => status.includes(l));
    const isExplicitlyUnsupported = UNSUPPORTED_LABELS.some((l) => status.includes(l));
    const isClaimedOnly = CLAIMED_ONLY_LABELS.some((l) => status.includes(l));

    if (isSupported && !hasEvidence) {
      problems.push(`claim[${i}] is marked "${status}" but evidenceReviewed_list is empty -- nothing for the claim to resolve to.`);
    }
    if (!isSupported && !isExplicitlyUnsupported && !isClaimedOnly) {
      problems.push(`claim[${i}] has status "${status}", which is not one of the three contract-defined labels (Claimed in rationale / Supported by attached evidence / Not traceable in record).`);
    }
  });

  return {
    id: 'D7-claim-evidence-traceability',
    description: 'Every claim in claimStatus_list resolves to evidenceReviewed_list or is explicitly labeled unsupported.',
    result: problems.length === 0 ? 'pass' : 'fail',
    detail: problems.length > 0 ? problems.join(' ') : undefined,
  };
}

export function detectSpecificationError(
  es: ExecutionSpecification,
  pkg: PromptPackage,
  artifact: CompletedArtifact,
): string[] {
  const issues: string[] = [];

  if (!Array.isArray(es?.requiredOutputs) || es.requiredOutputs.length === 0) {
    issues.push('Execution Specification requiredOutputs is missing or empty -- the contract does not define what the artifact must contain.');
  }

  if (!artifact || typeof artifact.structuredResponse !== 'object' || artifact.structuredResponse === null) {
    issues.push('Artifact structuredResponse is missing -- nothing was generated to validate against the contract.');
  }

  const sequence = pkg?.validationInstructions?.narrativeCheck?.expectedSequence;
  if (!Array.isArray(sequence) || sequence.length === 0) {
    issues.push('Prompt Package is missing a narrative expectedSequence -- narrative conformance cannot be evaluated against an undefined sequence.');
  }

  return issues;
}

export function runDeterministicValidation(
  artifact: CompletedArtifact,
  es: ExecutionSpecification,
  pkg: PromptPackage,
  runtimeManifest: RuntimeManifestInput,
): DeterministicResult {
  const checks: DeterministicCheck[] = [];

  checks.push({ id: 'D1-runtime-schema-report', description: 'Runtime Manifest reports schema validation as passed.', result: runtimeManifest.schemaValidation === 'passed' ? 'pass' : 'fail' });

  checks.push({ id: 'D2-prompt-package-checksum', description: 'Prompt Package checksum matches its declared content.', result: verifyPackageChecksum(pkg) ? 'pass' : 'fail' });

  const actualFields = Object.keys(artifact.structuredResponse).sort();
  const expectedFields = [...es.requiredOutputs].sort();
  const fieldsMatch = JSON.stringify(actualFields) === JSON.stringify(expectedFields);
  checks.push({ id: 'D3-required-fields-exact-match', description: 'Artifact fields exactly match Execution Specification requiredOutputs.', result: fieldsMatch ? 'pass' : 'fail', detail: fieldsMatch ? undefined : `Expected [${expectedFields.join(', ')}], got [${actualFields.join(', ')}].` });

  const allStrings = collectStrings(artifact.structuredResponse);
  const bannedHit = allStrings.find(containsBannedLanguage);
  checks.push({ id: 'D4-no-forbidden-language', description: 'No banned terminology present anywhere in the artifact.', result: bannedHit ? 'fail' : 'pass', detail: bannedHit ? `Banned term found in: "${bannedHit.slice(0, 120)}"` : undefined });

  const typeMismatches: string[] = [];
  for (const field of es.requiredOutputs) {
    const value = artifact.structuredResponse[field];
    const expectsArray = field.endsWith('_list') || field.endsWith('_items');
    if (expectsArray && !Array.isArray(value)) typeMismatches.push(field);
    if (!expectsArray && (Array.isArray(value) || typeof value !== 'string')) typeMismatches.push(field);
  }
  checks.push({ id: 'D5-field-types-conform', description: 'Every artifact field matches its declared output type.', result: typeMismatches.length === 0 ? 'pass' : 'fail', detail: typeMismatches.length > 0 ? `Type mismatches: [${typeMismatches.join(', ')}]` : undefined });

  checks.push({ id: 'D6-runtime-package-consistency', description: 'Runtime adapter matches the Prompt Package\'s target runtime.', result: runtimeManifest.runtimeAdapter === pkg.promptSpecification.targetRuntime ? 'pass' : 'fail', detail: runtimeManifest.runtimeAdapter === pkg.promptSpecification.targetRuntime ? undefined : `Runtime ran as "${runtimeManifest.runtimeAdapter}" but package targeted "${pkg.promptSpecification.targetRuntime}".` });

  checks.push(checkClaimEvidenceTraceability(artifact));

  return { status: checks.every((c) => c.result === 'pass') ? 'pass' : 'fail', checks };
}
