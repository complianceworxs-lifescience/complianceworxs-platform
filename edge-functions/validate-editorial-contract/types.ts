// types.ts

export type ValidationStatus = 'valid' | 'invalid';

export type ValidationFailureReason =
  | 'missing_required_field'
  | 'conflicting_rule'
  | 'underspecified_contract'
  | 'implementation_boundary_violation';

export interface ValidationIssue {
  reason: ValidationFailureReason;
  field: string;
  message: string;
  ruleRef?: string;
}

export interface ValidationResult {
  status: ValidationStatus;
  contractId: string | null;
  issues: ValidationIssue[];
  validationLevel: 'structural_and_referential';
}
