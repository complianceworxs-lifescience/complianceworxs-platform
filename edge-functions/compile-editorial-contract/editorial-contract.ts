export interface VersionMetadata { version: string; status: 'draft' | 'technical_review' | 'commercial_validation' | 'approved' | 'published' | 'superseded' | 'retired'; dependencies: string[]; }
export interface TraceabilityBlock { inheritsFrom: string[]; }
export interface EditorialContract {
  contractId: string; purpose: string; audience: string; commercialObjective: string;
  requiredInputs: string[]; requiredOutputs: string[]; narrativePattern: string;
  reasoningRules: string[]; evidenceRules: string[]; constraints: string[]; acceptanceCriteria: string[];
  traceability: TraceabilityBlock; versionMetadata: VersionMetadata;
}
export const PROHIBITED_KEYS = ['prompt', 'systemPrompt', 'system_prompt', 'userPrompt', 'model', 'temperature', 'maxTokens', 'max_tokens', 'apiKey', 'api_key', 'topP', 'top_p', 'stopSequences', 'modelProvider'] as const;
export const PROHIBITED_PHRASES = ['you are an ai', 'you are a helpful assistant', 'respond only in json', 'return only a raw json', 'do not include markdown', 'system:', 'anthropic-version', 'claude-', 'gpt-'] as const;