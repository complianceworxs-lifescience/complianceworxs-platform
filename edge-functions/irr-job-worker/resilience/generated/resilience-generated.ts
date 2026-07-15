// GENERATED FILE -- do not edit by hand.
// Source of truth: resilience/taxonomy.yaml + resilience/policy.yaml. Regenerate: node compile.js
// Milestone 7A (CW-MDR-007A) M7A-01/02: the ONE place reason -> category -> policy is defined.

export type ErrorCategory = 'contract' | 'business_logic' | 'model_output' | 'operational' | 'infrastructure';
export type BasePolicy = 'retryable' | 'conditional' | 'terminal';

export const TAXONOMY_VERSION = '1.0.0';
export const POLICY_VERSION = '1.0.0';
export const CATEGORIES: ErrorCategory[] = ["contract","business_logic","model_output","operational","infrastructure"];

export interface ReasonEntry { category: ErrorCategory; base_policy: BasePolicy; honor_retry_after?: boolean; }
// reason -> classification. The ONLY place this mapping exists (CW-ARCH-001 §9.3).
export const TAXONOMY: Record<string, ReasonEntry> = {
  "generation_timeout": {
    "category": "operational",
    "base_policy": "retryable"
  },
  "network_error": {
    "category": "operational",
    "base_policy": "retryable"
  },
  "rate_limit": {
    "category": "operational",
    "base_policy": "retryable",
    "honor_retry_after": true
  },
  "api_error": {
    "category": "operational",
    "base_policy": "conditional"
  },
  "platform_kill_exhausted_retries": {
    "category": "operational",
    "base_policy": "terminal"
  },
  "invalid_json_output": {
    "category": "model_output",
    "base_policy": "conditional"
  },
  "traceability_coverage_omitted": {
    "category": "model_output",
    "base_policy": "conditional"
  },
  "traceability_coverage_duplicated": {
    "category": "model_output",
    "base_policy": "conditional"
  },
  "contract_invalid": {
    "category": "contract",
    "base_policy": "terminal"
  },
  "execution_compile_failed": {
    "category": "contract",
    "base_policy": "terminal"
  },
  "prompt_package_invalid": {
    "category": "contract",
    "base_policy": "terminal"
  },
  "checksum_invalid": {
    "category": "contract",
    "base_policy": "terminal"
  },
  "manifest_invalid": {
    "category": "contract",
    "base_policy": "terminal"
  },
  "missing_context_variable": {
    "category": "contract",
    "base_policy": "terminal"
  },
  "unsupported_runtime": {
    "category": "contract",
    "base_policy": "terminal"
  },
  "invalid_response_schema": {
    "category": "business_logic",
    "base_policy": "terminal"
  },
  "structural_validation_failed": {
    "category": "business_logic",
    "base_policy": "terminal"
  },
  "traceability_coverage_mismatch": {
    "category": "business_logic",
    "base_policy": "terminal"
  },
  "unsupported_claims_coverage_mismatch": {
    "category": "business_logic",
    "base_policy": "terminal"
  },
  "inspector_challenge_coverage_mismatch": {
    "category": "business_logic",
    "base_policy": "terminal"
  },
  "remediation_scaffold_coverage_mismatch": {
    "category": "business_logic",
    "base_policy": "terminal"
  },
  "stage11_structural_inputs_missing": {
    "category": "business_logic",
    "base_policy": "terminal"
  },
  "authentication_error": {
    "category": "infrastructure",
    "base_policy": "terminal"
  }
};

// Fail-safe classification for an unmapped reason (bounded operational retry).
export const DEFAULT_REASON_ENTRY: ReasonEntry = {
  "category": "operational",
  "base_policy": "conditional"
};

export interface RetryPolicy {
  retry: boolean;
  max_attempts: number;
  backoff_base_ms: number;
  backoff_cap_ms: number;
  jitter_ratio: number;
  honor_retry_after: boolean;
}
// category -> retry policy. Values are provisional bootstraps (see policy.yaml provenance).
export const POLICY: Record<ErrorCategory, RetryPolicy> = {
  "operational": {
    "retry": true,
    "max_attempts": 6,
    "backoff_base_ms": 1000,
    "backoff_cap_ms": 60000,
    "jitter_ratio": 0.2,
    "honor_retry_after": true
  },
  "model_output": {
    "retry": true,
    "max_attempts": 2,
    "backoff_base_ms": 1000,
    "backoff_cap_ms": 15000,
    "jitter_ratio": 0.2,
    "honor_retry_after": false
  },
  "business_logic": {
    "retry": false,
    "max_attempts": 1,
    "backoff_base_ms": 0,
    "backoff_cap_ms": 0,
    "jitter_ratio": 0,
    "honor_retry_after": false
  },
  "contract": {
    "retry": false,
    "max_attempts": 1,
    "backoff_base_ms": 0,
    "backoff_cap_ms": 0,
    "jitter_ratio": 0,
    "honor_retry_after": false
  },
  "infrastructure": {
    "retry": false,
    "max_attempts": 1,
    "backoff_base_ms": 0,
    "backoff_cap_ms": 0,
    "jitter_ratio": 0,
    "honor_retry_after": false
  }
};

export interface BreakerConfig {
  enabled: boolean;
  window_seconds: number;
  consecutive_failures_threshold: number;
  cooldown_seconds: number;
  keyed_by: string;
}
// Circuit breaker config (M7A-10). enabled=false until operational evidence justifies it.
export const BREAKER: BreakerConfig = {
  "enabled": false,
  "window_seconds": 60,
  "consecutive_failures_threshold": 5,
  "cooldown_seconds": 30,
  "keyed_by": "provider"
};
