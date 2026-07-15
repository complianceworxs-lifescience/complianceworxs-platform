# IRR Resilience Taxonomy (generated from taxonomy.yaml + policy.yaml)

Taxonomy v1.0.0 · Policy v1.0.0

## Reason → Category → Base policy

| Reason | Category | Base policy | honor_retry_after |
|---|---|---|---|
| `generation_timeout` | operational | retryable |  |
| `network_error` | operational | retryable |  |
| `rate_limit` | operational | retryable | yes |
| `api_error` | operational | conditional |  |
| `platform_kill_exhausted_retries` | operational | terminal |  |
| `invalid_json_output` | model_output | conditional |  |
| `traceability_coverage_omitted` | model_output | conditional |  |
| `traceability_coverage_duplicated` | model_output | conditional |  |
| `contract_invalid` | contract | terminal |  |
| `execution_compile_failed` | contract | terminal |  |
| `prompt_package_invalid` | contract | terminal |  |
| `checksum_invalid` | contract | terminal |  |
| `manifest_invalid` | contract | terminal |  |
| `missing_context_variable` | contract | terminal |  |
| `unsupported_runtime` | contract | terminal |  |
| `invalid_response_schema` | business_logic | terminal |  |
| `structural_validation_failed` | business_logic | terminal |  |
| `traceability_coverage_mismatch` | business_logic | terminal |  |
| `unsupported_claims_coverage_mismatch` | business_logic | terminal |  |
| `inspector_challenge_coverage_mismatch` | business_logic | terminal |  |
| `remediation_scaffold_coverage_mismatch` | business_logic | terminal |  |
| `stage11_structural_inputs_missing` | business_logic | terminal |  |
| `authentication_error` | infrastructure | terminal |  |
| _(default / unmapped)_ | operational | conditional | |

## Category → Retry policy (provisional bootstraps)

| Category | retry | max_attempts | backoff_base_ms | backoff_cap_ms | jitter_ratio | honor_retry_after |
|---|---|---|---|---|---|---|
| contract | false | 1 | 0 | 0 | 0 | false |
| business_logic | false | 1 | 0 | 0 | 0 | false |
| model_output | true | 2 | 1000 | 15000 | 0.2 | false |
| operational | true | 6 | 1000 | 60000 | 0.2 | true |
| infrastructure | false | 1 | 0 | 0 | 0 | false |

## Circuit breaker (M7A-10)

`enabled: false` — ships off until operational evidence justifies it (CW-GOV-001 §7.3 "where justified").

