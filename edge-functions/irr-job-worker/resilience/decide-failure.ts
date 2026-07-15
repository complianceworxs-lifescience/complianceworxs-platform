// M7A-03/M7A-11 — shared failure-decision composition used by BOTH IRR execution paths.
//
// This is the exact composition each consumer's catch handler needs, extracted into one pure,
// directly-testable function (so the decision logic is executed against synthetic inputs, not
// just parity-analyzed). It wraps the central evaluator:
//   * "retryable in principle" is ceiling-independent (evaluate at attempt 1) — it answers
//     "is this reason retryable at all?" using the taxonomy, NOT the per-category ceiling;
//   * the COUNT ceiling is the CALLER's `maxAttempts` (each execution path keeps its own
//     existing ceiling — step 3/4 do not adopt the evaluator's per-category ceilings, D-2(a));
//   * `delay_ms` is the computed backoff (recorded, not enforced by the claim path in M7A).
import { evaluate } from './evaluate-policy.ts';
import type { EvaluateContext } from './evaluate-policy.ts';
import type { ErrorCategory } from './generated/resilience-generated.ts';

export interface FailureDecision {
  action: 'retry' | 'terminal';
  reason_normalized: string;   // e.g. api_error+429 -> rate_limit, +401 -> authentication_error
  category: ErrorCategory;
  delay_ms: number;            // recorded backoff for a retry; 0 for terminal
  exhausted: boolean;          // true iff retryable-in-principle but the caller's attempt ceiling is reached
}

export function decideFailure(reason: string, attempt: number, maxAttempts: number, context: EvaluateContext = {}): FailureDecision {
  const decision = evaluate(reason, attempt, context);
  const retryableInPrinciple = !evaluate(reason, 1, context).terminal; // ceiling-independent classification
  const action: 'retry' | 'terminal' = retryableInPrinciple && attempt < maxAttempts ? 'retry' : 'terminal';
  return {
    action,
    reason_normalized: decision.reason_normalized,
    category: decision.category,
    delay_ms: action === 'retry' ? decision.delayMs : 0,
    exhausted: retryableInPrinciple && action === 'terminal', // retryable reason that hit the ceiling
  };
}
