import { EditorialContract } from './editorial-contract.ts';
import { validateEditorialContract } from './editorial-validator.ts';
import { CompileResult, CompileIssue } from './types.ts';
import { ExecutionSpecification } from './execution-schema.ts';
import { normalizeStringArray } from './normalizer.ts';
import { resolveInheritanceClosure, checkCitationsAreInherited } from './resolver.ts';
import { NARRATIVE_PATTERN_SEQUENCES } from './rules.ts';
import { buildProvenance } from './manifest.ts';

export function compileEditorialContract(input: unknown): CompileResult {
  const validation = validateEditorialContract(input);
  if (validation.status !== 'valid') {
    return { status: 'failed', issues: [{ reason: 'source_contract_invalid', message: 'Source Editorial Contract failed Milestone 1 validation. Compilation refused.', sourceValidationIssues: validation.issues }] };
  }

  const contract = input as EditorialContract;
  const issues: CompileIssue[] = [];

  const { declaredInheritance, resolvedRuleIds, issues: inheritanceIssues } = resolveInheritanceClosure(contract.traceability.inheritsFrom);
  issues.push(...inheritanceIssues);

  issues.push(...checkCitationsAreInherited(contract.reasoningRules, resolvedRuleIds, 'reasoningRules'));
  issues.push(...checkCitationsAreInherited(contract.evidenceRules, resolvedRuleIds, 'evidenceRules'));
  issues.push(...checkCitationsAreInherited([contract.narrativePattern], resolvedRuleIds, 'narrativePattern'));

  if (issues.length > 0) return { status: 'failed', issues };

  const reasoningRules = normalizeStringArray(contract.reasoningRules);
  const evidenceRules = normalizeStringArray(contract.evidenceRules);
  const requiredInputs = normalizeStringArray(contract.requiredInputs);
  const requiredOutputs = normalizeStringArray(contract.requiredOutputs);
  const constraints = normalizeStringArray(contract.constraints);
  const acceptanceCriteria = normalizeStringArray(contract.acceptanceCriteria);

  const grammar = reasoningRules.filter((id) => id.startsWith('RG-') || id.startsWith('RM-') || id.startsWith('PF-'));
  const standards = reasoningRules.filter((id) => id.startsWith('RS-'));

  const expandedSequence = NARRATIVE_PATTERN_SEQUENCES[contract.narrativePattern];
  if (!expandedSequence) {
    return { status: 'failed', issues: [{ reason: 'compiler_internal_error', field: 'narrativePattern', ruleRef: contract.narrativePattern, message: `Narrative pattern "${contract.narrativePattern}" has no registered expansion sequence.` }] };
  }

  const specWithoutProvenance: Omit<ExecutionSpecification, 'compiler'> = {
    id: `ES-${contract.contractId}`,
    sourceContract: contract.contractId,
    reasoningProfile: { grammar, standards },
    evidenceProfile: evidenceRules,
    narrativeProfile: { patternId: contract.narrativePattern, expandedSequence },
    requiredInputs, requiredOutputs, constraints, acceptanceCriteria,
    traceability: { declaredInheritance, resolvedRuleIds },
  };

  const compiler = buildProvenance(contract.contractId, specWithoutProvenance);
  return { status: 'compiled', executionSpecification: { ...specWithoutProvenance, compiler } };
}