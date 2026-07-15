// M7A-03/M7A-05/M7A-06/M7A-08/M7A-09/M7A-11 — the single retry-policy evaluator.
//
// evaluate() is the ONLY place a retry/terminal decision is made. It classifies the reason
// (classify.ts), reads the category policy (generated POLICY), and returns a normalized decision:
// retry vs terminal, the backoff delay (exponential + deterministic jitter, or an honored
// Retry-After), and the normalized reason/category for diagnosable terminal errors (M7A-11).
//
// Pure and deterministic: no Math.random, no clock. Same inputs -> same decision (CP-A2). Per
// DR D-2 (option a), `delayMs` is COMPUTED AND RETURNED but the claim path does not wait on it
// in M7A — honoring the delay is Milestone 8.
import { POLICY, BREAKER } from './generated/resilience-generated.ts';
import type { ErrorCategory, BasePolicy } from './generated/resilience-generated.ts';
import { classify } from './classify.ts';
import type { ClassifyContext } from './classify.ts';

export interface EvaluateContext extends ClassifyContext {
  retryAfterMs?: number; // provider Retry-After, in ms, when present
  jitterKey?: string;    // per-job/stage key so concurrent retriers decorrelate (prod); fixed in tests
}

export interface RetryDecision {
  reason_normalized: string;
  category: ErrorCategory;
  base_policy: BasePolicy;
  attempt: number;
  max_attempts: number;
  retry: boolean;
  terminal: boolean;
  delayMs: number;
  honor_retry_after: boolean;
  breaker_open: boolean;
}

export function evaluate(reason: string, attempt: number, context: EvaluateContext = {}): RetryDecision {
  const c = classify(reason, context);
  const policy = POLICY[c.category];
  const breaker_open = BREAKER.enabled === true ? false : false; // breaker gated off until step 6 (evidence)

  let retry: boolean;
  let terminal: boolean;
  if (c.base_policy === 'terminal' || policy.retry === false) {
    retry = false; terminal = true;                 // deterministic / non-retryable
  } else if (attempt >= policy.max_attempts) {
    retry = false; terminal = true;                 // exhausted the (bootstrap) ceiling
  } else {
    retry = true; terminal = false;
  }

  let delayMs = 0;
  if (retry) {
    if (c.honor_retry_after && typeof context.retryAfterMs === 'number') {
      delayMs = context.retryAfterMs;               // honor the provider's Retry-After (M7A-07)
    } else {
      const base = Math.min(policy.backoff_cap_ms, policy.backoff_base_ms * Math.pow(2, attempt - 1)); // exponential (M7A-05)
      delayMs = applyJitter(base, policy.jitter_ratio, context.jitterKey ?? c.reason_normalized, attempt); // jitter (M7A-06)
    }
  }

  return {
    reason_normalized: c.reason_normalized,
    category: c.category,
    base_policy: c.base_policy,
    attempt,
    max_attempts: policy.max_attempts,
    retry,
    terminal,
    delayMs,
    honor_retry_after: c.honor_retry_after,
    breaker_open,
  };
}

// Deterministic jitter (M7A-06): reproducible for a given (key, attempt) so decisions are
// testable, yet decorrelating across different keys — pass a per-job key in production, a
// fixed key in tests. factor in [1 - ratio, 1 + ratio]. No Math.random.
export function applyJitter(base: number, ratio: number, key: string, attempt: number): number {
  if (ratio <= 0 || base <= 0) return Math.round(base);
  const unit = (fnv1a(`${key}:${attempt}`) % 100000) / 100000; // [0, 1)
  const factor = 1 + (unit * 2 - 1) * ratio;                    // [1 - ratio, 1 + ratio)
  return Math.round(base * factor);
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}
