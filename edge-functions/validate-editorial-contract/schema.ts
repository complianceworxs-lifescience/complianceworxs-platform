// schema.ts
//
// Canonical Editorial Contract schema, per Chapter 7 §4 (ECS-001
// through ECS-013) of the ComplianceWorxs Editorial Architecture
// v2.0.0. This is a structural type only — it does not encode the
// content of Chapters 1-6; it encodes the SHAPE a contract must
// have to be checked against that content by the validator.

export interface VersionMetadata {
  version: string;
  status: 'draft' | 'technical_review' | 'commercial_validation' | 'approved' | 'published' | 'superseded' | 'retired';
  dependencies: string[];
}

export interface TraceabilityBlock {
  inheritsFrom: string[];
}

export interface EditorialContract {
  contractId: string;
  purpose: string;
  audience: string;
  commercialObjective: string;
  requiredInputs: string[];
  requiredOutputs: string[];
  narrativePattern: string;
  reasoningRules: string[];
  evidenceRules: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  traceability: TraceabilityBlock;
  versionMetadata: VersionMetadata;
}

export const PROHIBITED_KEYS = [
  'prompt', 'systemPrompt', 'system_prompt', 'userPrompt', 'model',
  'temperature', 'maxTokens', 'max_tokens', 'apiKey', 'api_key',
  'topP', 'top_p', 'stopSequences', 'modelProvider',
] as const;

export const PROHIBITED_PHRASES = [
  'you are an ai',
  'you are a helpful assistant',
  'respond only in json',
  'return only a raw json',
  'do not include markdown',
  'system:',
  'anthropic-version',
  'claude-',
  'gpt-',
] as const;
