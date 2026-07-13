import { EditorialContract, PROHIBITED_KEYS, PROHIBITED_PHRASES } from './editorial-contract.ts';
import { ValidationIssue, ValidationResult } from './validation-types.ts';
import { ruleExists, ruleCategory, chapterExists, RuleCategory } from './rules.ts';

const MIN_MEANINGFUL_LENGTH = 10;
function isNonEmptyString(v: unknown): v is string { return typeof v === 'string' && v.trim().length > 0; }
function isStringArray(v: unknown): v is string[] { return Array.isArray(v) && v.every((x) => typeof x === 'string'); }

function collectStringsAndKeys(obj: unknown, strings: string[] = [], keys: string[] = []): { strings: string[]; keys: string[] } {
  if (obj === null || obj === undefined) return { strings, keys };
  if (typeof obj === 'string') { strings.push(obj); return { strings, keys }; }
  if (Array.isArray(obj)) { for (const item of obj) collectStringsAndKeys(item, strings, keys); return { strings, keys }; }
  if (typeof obj === 'object') { for (const [k, v] of Object.entries(obj as Record<string, unknown>)) { keys.push(k); collectStringsAndKeys(v, strings, keys); } }
  return { strings, keys };
}

function checkImplementationBoundary(raw: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { strings, keys } = collectStringsAndKeys(raw);
  const lowerKeys = keys.map((k) => k.toLowerCase());
  for (const prohibited of PROHIBITED_KEYS) { if (lowerKeys.includes(prohibited.toLowerCase())) { issues.push({ reason: 'implementation_boundary_violation', field: prohibited, message: `Contract contains the field "${prohibited}".` }); } }
  const haystack = strings.join(' \n ').toLowerCase();
  for (const phrase of PROHIBITED_PHRASES) { if (haystack.includes(phrase)) { issues.push({ reason: 'implementation_boundary_violation', field: '(nested string content)', message: `Contract content contains the phrase "${phrase}".` }); } }
  return issues;
}

function checkRequiredMetadata(c: Partial<EditorialContract>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const requiredProseFields: (keyof EditorialContract)[] = ['contractId', 'purpose', 'audience', 'commercialObjective'];
  for (const field of requiredProseFields) {
    const value = c[field];
    if (!isNonEmptyString(value)) { issues.push({ reason: 'missing_required_field', field, message: `Required field "${field}" is missing or empty.` }); }
    else if (value.trim().length < MIN_MEANINGFUL_LENGTH) { issues.push({ reason: 'underspecified_contract', field, message: `Field "${field}" is too short.` }); }
  }
  if (!isNonEmptyString(c.narrativePattern)) { issues.push({ reason: 'missing_required_field', field: 'narrativePattern', message: 'Required field "narrativePattern" is missing or empty.' }); }
  return issues;
}

function checkArrayFields(c: Partial<EditorialContract>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const requiredNonEmptyArrays: (keyof EditorialContract)[] = ['requiredInputs', 'requiredOutputs', 'acceptanceCriteria'];
  for (const field of requiredNonEmptyArrays) {
    const value = c[field];
    if (!isStringArray(value)) { issues.push({ reason: 'missing_required_field', field, message: `Required field "${field}" must be an array of strings.` }); }
    else if (value.length === 0) { issues.push({ reason: 'missing_required_field', field, message: `Required field "${field}" is present but empty.` }); }
  }
  if (!isStringArray(c.constraints)) { issues.push({ reason: 'missing_required_field', field: 'constraints', message: 'Field "constraints" must be an array of strings (may be empty).' }); }
  return issues;
}

function checkVersionMetadata(c: Partial<EditorialContract>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const vm = c.versionMetadata;
  if (!vm || typeof vm !== 'object') { issues.push({ reason: 'missing_required_field', field: 'versionMetadata', message: 'Field "versionMetadata" is required.' }); return issues; }
  if (!isNonEmptyString(vm.version)) { issues.push({ reason: 'missing_required_field', field: 'versionMetadata.version', message: 'versionMetadata.version is required.' }); }
  if (!isNonEmptyString(vm.status)) { issues.push({ reason: 'missing_required_field', field: 'versionMetadata.status', message: 'versionMetadata.status is required.' }); }
  if (!isStringArray(vm.dependencies) || vm.dependencies.length === 0) { issues.push({ reason: 'missing_required_field', field: 'versionMetadata.dependencies', message: 'versionMetadata.dependencies must declare at least one governing chapter.' }); }
  else { for (const dep of vm.dependencies) { if (!chapterExists(dep)) { issues.push({ reason: 'conflicting_rule', field: 'versionMetadata.dependencies', ruleRef: dep, message: `Declared dependency "${dep}" does not match any chapter.` }); } } }
  return issues;
}

function checkTraceability(c: Partial<EditorialContract>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tb = c.traceability;
  if (!tb || !isStringArray(tb.inheritsFrom) || tb.inheritsFrom.length === 0) { issues.push({ reason: 'missing_required_field', field: 'traceability.inheritsFrom', message: 'traceability.inheritsFrom must declare at least one inherited rule ID or chapter.' }); return issues; }
  for (const ref of tb.inheritsFrom) {
    const looksLikeChapterRef = /^chapter\s*\d+$/i.test(ref) || chapterExists(ref);
    if (looksLikeChapterRef) { if (!chapterExists(ref)) { issues.push({ reason: 'conflicting_rule', field: 'traceability.inheritsFrom', ruleRef: ref, message: `"${ref}" does not match any known chapter.` }); } continue; }
    if (!ruleExists(ref)) { issues.push({ reason: 'conflicting_rule', field: 'traceability.inheritsFrom', ruleRef: ref, message: `Rule "${ref}" does not exist.` }); }
  }
  return issues;
}

function checkRuleFamily(fieldName: 'reasoningRules' | 'evidenceRules', contract: Partial<EditorialContract>, allowedCategories: RuleCategory[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const values = contract[fieldName];
  if (!isStringArray(values) || values.length === 0) { issues.push({ reason: 'missing_required_field', field: fieldName, message: `"${fieldName}" must cite at least one rule ID.` }); return issues; }
  for (const ref of values) {
    if (!ruleExists(ref)) { issues.push({ reason: 'conflicting_rule', field: fieldName, ruleRef: ref, message: `Rule "${ref}" does not exist.` }); continue; }
    const category = ruleCategory(ref);
    if (!category || !allowedCategories.includes(category)) { issues.push({ reason: 'conflicting_rule', field: fieldName, ruleRef: ref, message: `Rule "${ref}" belongs to category "${category}", not one of [${allowedCategories.join(', ')}].` }); }
  }
  return issues;
}

function checkNarrativePattern(c: Partial<EditorialContract>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const np = c.narrativePattern;
  if (!isNonEmptyString(np)) return issues;
  if (!ruleExists(np)) { issues.push({ reason: 'conflicting_rule', field: 'narrativePattern', ruleRef: np, message: `"${np}" is not a known Narrative Pattern ID.` }); return issues; }
  if (ruleCategory(np) !== 'NP') { issues.push({ reason: 'conflicting_rule', field: 'narrativePattern', ruleRef: np, message: `"${np}" is not a Narrative Pattern.` }); }
  return issues;
}

export function validateEditorialContract(input: unknown): ValidationResult {
  const boundaryIssues = checkImplementationBoundary(input);
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { status: 'invalid', contractId: null, validationLevel: 'structural_and_referential', issues: [{ reason: 'missing_required_field', field: '(root)', message: 'Submitted contract must be a JSON object.' }, ...boundaryIssues] };
  }
  const c = input as Partial<EditorialContract>;
  const issues: ValidationIssue[] = [
    ...boundaryIssues, ...checkRequiredMetadata(c), ...checkArrayFields(c), ...checkVersionMetadata(c),
    ...checkTraceability(c), ...checkNarrativePattern(c),
    ...checkRuleFamily('reasoningRules', c, ['RG', 'RS']), ...checkRuleFamily('evidenceRules', c, ['ES']),
  ];
  return { status: issues.length === 0 ? 'valid' : 'invalid', contractId: isNonEmptyString(c.contractId) ? c.contractId : null, validationLevel: 'structural_and_referential', issues };
}