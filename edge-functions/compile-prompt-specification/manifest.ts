import { ExecutionSpecification } from './execution-schema.ts';
import { computeChecksum } from './m2-manifest.ts';
import { RULE_REGISTRY_VERSION } from './m2-rules-const.ts';
import { PromptCompileIssue } from './types.ts';

export const EXPECTED_ARCHITECTURE_VERSION = '2.0.0';
export const EXPECTED_M2_COMPILER_VERSION = '1.0.0';
export const EXPECTED_RULE_REGISTRY_VERSION = RULE_REGISTRY_VERSION;
export const PROMPT_COMPILER_VERSION = '1.0.0';

function isNonEmptyString(v: unknown): v is string { return typeof v === 'string' && v.trim().length > 0; }
function isStringArray(v: unknown): v is string[] { return Array.isArray(v) && v.every((x) => typeof x === 'string'); }

export function checkExecutionSpecificationShape(input: unknown): PromptCompileIssue[] {
  const issues: PromptCompileIssue[] = [];
  if (typeof input !== 'object' || input === null) {
    return [{ reason: 'execution_specification_invalid', field: '(root)', message: 'Execution Specification must be an object.' }];
  }
  const es = input as Partial<ExecutionSpecification>;
  if (!isNonEmptyString(es.id)) issues.push({ reason: 'execution_specification_invalid', field: 'id', message: 'Missing id.' });
  if (!isNonEmptyString(es.sourceContract)) issues.push({ reason: 'execution_specification_invalid', field: 'sourceContract', message: 'Missing sourceContract.' });
  if (!es.reasoningProfile || !isStringArray(es.reasoningProfile.grammar) || !isStringArray(es.reasoningProfile.standards)) {
    issues.push({ reason: 'execution_specification_invalid', field: 'reasoningProfile', message: 'Missing or malformed reasoningProfile.' });
  }
  if (!isStringArray(es.evidenceProfile)) issues.push({ reason: 'execution_specification_invalid', field: 'evidenceProfile', message: 'Missing evidenceProfile.' });
  if (!es.narrativeProfile || !isNonEmptyString(es.narrativeProfile.patternId) || !isStringArray(es.narrativeProfile.expandedSequence)) {
    issues.push({ reason: 'execution_specification_invalid', field: 'narrativeProfile', message: 'Missing or malformed narrativeProfile.' });
  }
  if (!isStringArray(es.requiredInputs)) issues.push({ reason: 'execution_specification_invalid', field: 'requiredInputs', message: 'Missing requiredInputs.' });
  if (!isStringArray(es.requiredOutputs) || es.requiredOutputs.length === 0) issues.push({ reason: 'execution_specification_invalid', field: 'requiredOutputs', message: 'Missing or empty requiredOutputs.' });
  if (!isStringArray(es.constraints)) issues.push({ reason: 'execution_specification_invalid', field: 'constraints', message: 'Missing constraints.' });
  if (!isStringArray(es.acceptanceCriteria) || es.acceptanceCriteria.length === 0) issues.push({ reason: 'execution_specification_invalid', field: 'acceptanceCriteria', message: 'Missing or empty acceptanceCriteria.' });
  if (!es.traceability || !isStringArray(es.traceability.resolvedRuleIds)) issues.push({ reason: 'execution_specification_invalid', field: 'traceability', message: 'Missing traceability.resolvedRuleIds.' });
  if (!es.compiler) issues.push({ reason: 'execution_specification_invalid', field: 'compiler', message: 'Missing compiler provenance block.' });
  return issues;
}

export function verifyProvenance(es: ExecutionSpecification): PromptCompileIssue[] {
  const issues: PromptCompileIssue[] = [];
  const { compiler } = es;
  if (compiler.architectureVersion !== EXPECTED_ARCHITECTURE_VERSION) {
    issues.push({ reason: 'provenance_mismatch', field: 'compiler.architectureVersion', message: `Execution Specification was compiled against architecture ${compiler.architectureVersion}, but this Prompt Compiler expects ${EXPECTED_ARCHITECTURE_VERSION}.` });
  }
  if (compiler.compilerVersion !== EXPECTED_M2_COMPILER_VERSION) {
    issues.push({ reason: 'provenance_mismatch', field: 'compiler.compilerVersion', message: `Execution Specification was compiled by compiler ${compiler.compilerVersion}, but this Prompt Compiler expects ${EXPECTED_M2_COMPILER_VERSION}.` });
  }
  if (compiler.ruleRegistryVersion !== EXPECTED_RULE_REGISTRY_VERSION) {
    issues.push({ reason: 'provenance_mismatch', field: 'compiler.ruleRegistryVersion', message: `Execution Specification cites rule registry ${compiler.ruleRegistryVersion}, but this Prompt Compiler expects ${EXPECTED_RULE_REGISTRY_VERSION}.` });
  }
  const { compiler: compilerFieldsForHash, ...specWithoutCompiler } = es;
  const { timestamp, checksum, ...compilerWithoutTimestampOrChecksum } = compilerFieldsForHash;
  const recomputed = computeChecksum({ ...specWithoutCompiler, compiler: compilerWithoutTimestampOrChecksum });
  if (recomputed !== checksum) {
    issues.push({ reason: 'provenance_mismatch', field: 'compiler.checksum', message: `Recomputed checksum (${recomputed}) does not match the Execution Specification's declared checksum (${checksum}).` });
  }
  return issues;
}
