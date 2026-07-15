// M7A-02/M7A-07 — reason classification (consumes the generated taxonomy; never re-derives it).
//
// classify() turns a raw thrown reason into a normalized classification. Provider errors that
// surface today as a single `api_error` (CW-MDR-007A §6.4 — the two real gaps) are subclassified
// here by HTTP status: 429 -> rate_limit (operational), 401/403 -> authentication_error
// (infrastructure/terminal), 5xx -> api_error (operational, retryable), other 4xx -> terminal
// client error. Everything else is looked up in the generated TAXONOMY (fail-safe default for
// an unmapped reason).
import { TAXONOMY, DEFAULT_REASON_ENTRY } from './generated/resilience-generated.ts';
import type { ReasonEntry, ErrorCategory, BasePolicy } from './generated/resilience-generated.ts';

export interface ClassifyContext {
  httpStatus?: number; // provider HTTP status, when the failure came from a model/API call
}

export interface Classification {
  reason_normalized: string;
  category: ErrorCategory;
  base_policy: BasePolicy;
  honor_retry_after: boolean;
}

function fromTaxonomy(reason: string): Classification {
  const e: ReasonEntry = TAXONOMY[reason] ?? DEFAULT_REASON_ENTRY;
  return { reason_normalized: reason, category: e.category, base_policy: e.base_policy, honor_retry_after: !!e.honor_retry_after };
}

export function classify(reason: string, context: ClassifyContext = {}): Classification {
  // Subclassify opaque provider errors (masked as api_error in production today).
  if (reason === 'api_error' && typeof context.httpStatus === 'number') {
    const s = context.httpStatus;
    if (s === 429) return fromTaxonomy('rate_limit');                 // -> operational, honor Retry-After
    if (s === 401 || s === 403) return fromTaxonomy('authentication_error'); // -> infrastructure, terminal
    if (s >= 500) return fromTaxonomy('api_error');                   // provider 5xx -> operational, retryable
    if (s >= 400) return { reason_normalized: 'api_error', category: 'infrastructure', base_policy: 'terminal', honor_retry_after: false }; // other 4xx -> terminal client error
  }
  return fromTaxonomy(reason);
}
