// M7A-10 — circuit-breaker policy (SPECIFIED, ships OFF until evidence justifies it).
//
// "Circuit-breaker policy where justified" (CW-GOV-001 §7.3). Per DR §10 / A-06 / N-09 the
// breaker ships enabled ONLY if operational telemetry (M7A-12) shows correlated provider
// outages. As of build step 6 there is no accumulated operational-outage evidence (telemetry
// landed in step 5), so BREAKER.enabled is false and this logic is a no-op in production — the
// shape is defined and proven (fault-injection test) so a later, evidence-backed step can enable
// it without a redesign.
//
// D-3 resolved: the breaker state store (a dedicated m7a_circuit_state table) is DEFERRED, not
// built now — persisting breaker state is only meaningful once the breaker is enabled, and adding
// it now would be schema DDL for a disabled feature. When evidence justifies enabling the breaker,
// that step adds the state table (DDL) and wires these functions into the runtime.
//
// Pure and clock-injected (nowMs passed in), so it is deterministic and testable. Config is
// injectable (defaults to the generated BREAKER) so a fault-injection test can exercise the
// enabled behavior without changing the shipped, disabled config.
import { BREAKER } from './generated/resilience-generated.ts';
import type { BreakerConfig } from './generated/resilience-generated.ts';

export const CIRCUIT_OPEN_REASON = 'circuit_open';

export interface BreakerState {
  consecutive_failures: number;
  opened_at: number | null; // epoch ms when the breaker opened, or null while closed
}

export const CLOSED: BreakerState = { consecutive_failures: 0, opened_at: null };

// Is the circuit currently OPEN (short-circuit new attempts to a fast terminal)? Open only while
// within the cooldown window after opening; disabled config is always closed.
export function circuitOpen(state: BreakerState, nowMs: number, config: BreakerConfig = BREAKER): boolean {
  if (!config.enabled) return false;
  if (state.opened_at === null) return false;
  return (nowMs - state.opened_at) / 1000 < config.cooldown_seconds;
}

// Fold one dependency outcome into breaker state. A success (or non-operational terminal) resets
// the counter; an operational failure increments it and OPENS the breaker at the threshold.
export function recordOutcome(state: BreakerState, outcome: 'operational_failure' | 'success', nowMs: number, config: BreakerConfig = BREAKER): BreakerState {
  if (!config.enabled) return CLOSED;
  if (outcome === 'success') return CLOSED;
  const consecutive = state.consecutive_failures + 1;
  const shouldOpen = consecutive >= config.consecutive_failures_threshold;
  return { consecutive_failures: consecutive, opened_at: shouldOpen ? (state.opened_at ?? nowMs) : state.opened_at };
}
