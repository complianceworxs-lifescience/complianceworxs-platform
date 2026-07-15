# CW-MDR-007A — Milestone 7A Design Review

**Status:** APPROVED v1.0 (+ v1.1 factual correction) — implementation **AUTHORIZED** (CW-GOV-001 §4A gate passed).

**v1.1 correction (2026-07-15, append-only, post-approval):** grounding fix, not a scope or
decision change. §6.2 and the §9.2 note previously implied `irr-stage-engine` handled
`invalid_response_schema` itself. The step-3 parity analysis disproved this: the engine emits
`structural_validation_failed` (already terminal) for its schema-validation stage and **never**
emits `invalid_response_schema`, which is a runtime-emitted, worker-only reason. Corrected in §6.2
and §9.2 so the §6.2 correction is accurately attributed to `irr-job-worker` (step 4) before the
worker refactor builds on it. No acceptance criterion, decision, or scope changed.
**Milestone:** 7A — Resilient Execution (CW-GOV-001 §7)
**Author:** Claude Code (implementer)
**Date drafted:** 2026-07-15
**Approval authority:** CEO / Milestone Owner (per CW-GOV-001 §12).
**Approved:** Jon Nugent — CEO / Milestone Owner, 2026-07-15. Implementation authorized.

**Resolved at approval:** D-1 — `irr-stage-engine` is production-authoritative (empirical, §6.7).
D-2 — option (a) confirmed: M7A records the retry decision (incl. `delayMs`) but the claim path
does not wait on it; honoring the delay is deferred to Milestone 8 (locked in §8, §10 M7A-05,
D-2). `irr-job-worker`'s align-or-retire fate is left as a build step-4 decision (§12 step 4),
not a blocker to starting. Path: v0.1 (initial draft) → v0.2 (owner review) → v1.0 (approved).

---

## 1. Purpose

Milestone 7A centralizes **failure classification** and **retry-policy evaluation** for the
IRR execution path, and adds the resilience behaviors (backoff, jitter, rate-limit/timeout/
network handling, circuit-breaking where justified, terminal-error normalization, and retry
telemetry) required by CW-GOV-001 §7. This Design Review scopes that work, grounds it in the
code that exists today, and maps every §7 sub-requirement to an implementable ID with
acceptance and non-acceptance criteria. It authorizes nothing; it precedes implementation.

The central problem it addresses, stated concretely from the current code (§7 below):
retryability is decided **at each throw site**, **differently in each of the two IRR
execution paths**, with **no backoff, no jitter, no rate-limit handling, and no
circuit-breaker** — so transient failures and deterministic failures are treated by
scattered, sometimes contradictory rules.

## 2. Governing References

- **CW-GOV-001 §7** — the authoritative scope, error categories, initial classification,
  success metrics, and exclusions for Milestone 7A (governing spec).
- **CW-GOV-001 §4A** — Milestone Design Review gate: no implementation before approval.
- **CW-GOV-001 §12** — closure/approval authority (Milestone Owner).
- **CW-MDR-007 (Milestone 7, closed)** — the verification foundation this milestone reuses:
  the compiler "single canonical source → generated copy → verify gate" pattern, the stage
  certification / regression harness, and `npm run verify` gate selection.
- **CW-EXEC-001** — Execution Specification vocabulary (terminal state; §24). M7A must not
  redefine "terminal state"; it normalizes onto it.
- **CW-ARCH-001 §9.3 / §9.9** — contract-first (a single source of truth, consumers never
  re-derive it) and "no workflow change without an approved Execution Specification."

## 3. Traceability Spine (every §7 sub-requirement → an ID)

**Scope (§7.3):**

| ID | §7.3 requirement |
|----|------------------|
| M7A-01 | Centralized error taxonomy |
| M7A-02 | Map stage-specific error codes → categories |
| M7A-03 | Centralized retry-policy evaluation |
| M7A-04 | Evidence-based retry limits (not arbitrary fixed values) |
| M7A-05 | Exponential backoff |
| M7A-06 | Jitter |
| M7A-07 | Rate-limit handling |
| M7A-08 | Timeout handling |
| M7A-09 | Network-error handling |
| M7A-10 | Circuit-breaker policy where justified |
| M7A-11 | Terminal-error normalization |
| M7A-12 | Retry and failure telemetry |

**Error categories (§7.4):** contract · business logic · model output · operational ·
infrastructure — realized in M7A-01/02.

**Initial classification (§7.5)** seeds M7A-02 (see §9.2); final policies are evidence-based
(M7A-04), not the §7.5 starting values.

**Success metrics (§7.6) → acceptance A-01…A-06 (see §17).**

## 4. Objective (CW-GOV-001 §7.2)

Centralize failure classification and improve automatic recovery from transient
model-provider, network, and operational conditions — so transient failures normally recover
without manual requeue, deterministic failures are not retried unchanged, and terminal
failures stay explicit and diagnosable.

## 5. In-Scope Components (CW-GOV-001 §7.3, full)

All of §7.3: centralized error taxonomy; mapping stage-specific error codes to categories;
centralized retry-policy evaluation; evidence-based retry limits; exponential backoff;
jitter; rate-limit handling; timeout handling; network-error handling; circuit-breaker
policy where justified; terminal-error normalization; retry and failure telemetry.

## 6. Current-State Grounding (what exists today — verified against the repo)

This section is drawn from the recovered production code, not assumptions.

### 6.1 The `{ retryable, reason, message }` throw shape already exists

`edge-functions/irr-stage-engine/index.ts` throws a consistent error object shape throughout
(e.g. `throw { retryable: false, reason: 'contract_invalid', message: … }`,
`throw { retryable: gen.reason === 'generation_timeout', reason: gen.reason, message: … }`).
The catch handler (index.ts ~L828–854) reads `err.retryable`, computes
`canRetry = retryable && attempt < maxAttempts`, and on retry sets the stage row back to
`status: 'queued'` with `classified_failure = err.reason`; otherwise marks the stage and job
`failed` with the reason. **Retryability is decided at the throw site.**

### 6.2 Two IRR execution paths classify differently (the core inconsistency)

- **`irr-stage-engine`** (per-stage, poll/claim via `claim_next_active_irr_job`, `attempt` /
  `max_attempts` default 6, `stallReclaim`) decides retryability inline per throw, e.g.
  `retryable: gen.reason === 'generation_timeout'`.
- **`irr-job-worker`** (`pipeline.ts` + `job-store.ts`, `claim_next_irr_job`,
  `requeueJobForRetry`, `reclaimOverdueJobs`, `deadline_at`, `attempt_count` / `max_attempts`)
  decides retryability from a **hardcoded set**:
  `const RETRYABLE_STAGES = new Set(['invalid_json_output', 'invalid_response_schema'])`.

These disagree on the same **logical** failure (a schema-invalid model output), which the two
paths emit under **different reason codes**: `irr-job-worker` surfaces the runtime's
`invalid_response_schema` and treats it **retryable**, while `irr-stage-engine` throws its own
`structural_validation_failed` and treats it **non-retryable**. The engine does **not** emit
`invalid_response_schema` at all — that reason originates in `runtime/runtime.ts` and reaches
only the worker path (confirmed by the step-3 parity analysis, CW commit history). Centralization
(M7A-01/02/03) exists to make one authority decide, and normalizes **both** reason codes to
business_logic/terminal.

### 6.3 Observed reason codes (the taxonomy seed — real, not invented)

From `irr-stage-engine`: `api_error`, `generation_timeout`, `network_error`,
`contract_invalid`, `execution_compile_failed`, `prompt_package_invalid`,
`invalid_json_output`, `traceability_coverage_omitted` / `_duplicated` (retryable),
`traceability_coverage_mismatch`, `unsupported_claims_coverage_mismatch`,
`inspector_challenge_coverage_mismatch`, `remediation_scaffold_coverage_mismatch`,
`stage11_structural_inputs_missing`, `structural_validation_failed`,
`platform_kill_exhausted_retries`.
From `runtime/runtime.ts` (`RuntimeIssue.reason`): `checksum_invalid`, `manifest_invalid`,
`missing_context_variable`, `unsupported_runtime`, `network_error`, `invalid_json_output`,
`invalid_response_schema`.

### 6.4 What does NOT exist today (net-new in M7A)

- **No backoff, no jitter, no circuit-breaker** anywhere (`backoff` / `circuit` occurrences:
  0). On a retryable error the row is re-queued and picked up by the next claim cycle —
  there is no delay schedule.
- **No `rate_limit` / `429` / `Retry-After` handling in the IRR path.** A 429 from the model
  provider surfaces as `api_error` (`data.error` branch), which has **no retryable mapping**
  and is therefore effectively treated as terminal. `authentication_error` (§7.5) is likewise
  absent and would fall through as `api_error`.
- **No error-category dimension** persisted. `irr_stage_runs` has `classified_failure` (the
  reason string), `error_detail`, `attempt`, `max_attempts`, `stop_reason`; `irr_jobs` has
  `error_json`, `terminal_state`, `attempt_count`, `max_attempts`, `deadline_at`. There is no
  `error_category` column and no retry-delay / retry-telemetry aggregate.

### 6.5 How code is shared today (grounds the "centralize" mechanism)

There is **no `_shared` module** and no cross-function relative imports; each edge function is
a self-contained bundle. The repo's established way to share one definition across functions
is the **compiler precedent**: a single canonical source (`compiler/contract.yaml`) generates
an artifact (`contract-generated.ts`) that is **copied into each consuming function**
(`edge-functions/irr-stage-engine/contract-generated.ts`), with an M7 **verify gate** proving
the copy matches the source. M7A centralizes the taxonomy the same way (§11).

### 6.6 Scheduler/worker plumbing is out of scope (the M8 boundary)

The claim/re-queue/reclaim/deadline machinery — `claim_next_active_irr_job`,
`claim_next_irr_job`, `requeueJobForRetry`, `reclaimOverdueJobs`, `setDeadline`,
`stallReclaim`, and `runtime-worker` — is **worker/scheduler behavior (Milestone 8)**.
`pipeline-watchdog` is a marketing/sales cron monitor, unrelated to IRR. M7A produces the
**classification and policy decision** these mechanisms consume; it does **not** redesign
claiming, re-queueing, reclaim timing, cron, or worker ownership. See §8.

### 6.7 D-1 resolved — `irr-stage-engine` is production-authoritative (empirical)

Settled from live data (2026-07-15), not inference: `irr_stage_runs` is written one row
per stage **only** by `irr-stage-engine` as it claims and advances work; `irr-job-worker`
runs single-shot and never writes that table. In the last 24 h there are 31 stage-run rows,
and the most recent (15:08:19) post-dates the most recent job's creation (14:57:16) — i.e. a
job being actively worked stage-by-stage, right now, by `irr-stage-engine`. **Authoritative
path: `irr-stage-engine`.** `irr-job-worker`'s status (fully retired vs idle) is not equally
certain, but it is not producing current traffic. Consequences are folded into §9.2, §12
step 4, R-02, and R-04.

## 7. (reserved)

## 8. Explicit Exclusions (CW-GOV-001 §7.7 + the Milestone 8 boundary)

Out of scope and must not be built under this milestone:

- product-service development;
- full scheduler redesign;
- removal of checkpointing;
- latency optimization unrelated to resilience;
- **anything belonging to Milestone 8's worker/cron/scheduler work** — specifically: changing
  how jobs/stages are claimed, re-queued, reclaimed, or deadlined; `runtime-worker`
  scheduling; cron cadence; worker-owned continuous execution. **D-2 is confirmed to option
  (a) (owner review 2026-07-15):** M7A **computes and records** the retry decision (including
  `delayMs`); the claim path **does not wait** on that delay — *honoring* it is deferred to
  Milestone 8. No `next_attempt_at` claim-filter change ships in M7A. This is the single most
  load-bearing scope boundary in the milestone and is locked here; N-12 (§18) fails the
  milestone if it is crossed.

A dedicated non-acceptance condition (N-12, §18) fails the milestone if scheduler/worker
redesign is introduced — mirroring M7's N-12 scope-creep guard.

## 9. Error Taxonomy Design (M7A-01, M7A-02; §7.4/§7.5)

### 9.1 Categories (§7.4)

`contract` · `business_logic` · `model_output` · `operational` · `infrastructure`.

### 9.2 Canonical reason → category → base policy map (single source of truth)

Seeded from §7.5 and the observed reason codes (§6.3). Base policy is the *class default*;
concrete retry limits/backoff come from M7A-04 evidence, not from this table.

| Reason (observed) | Category | Base policy |
|-------------------|----------|-------------|
| `generation_timeout` | operational | retryable (transient) |
| `network_error` | operational | retryable (transient) |
| `rate_limit` *(new; today masked as `api_error`)* | operational | retryable, honor `Retry-After` |
| `api_error` *(provider error, uncategorized)* | operational | conditional (subclassify: 429/5xx→retryable, 4xx-auth→terminal) |
| `invalid_json_output` | model_output | conditional (retry bounded — a re-generation may fix truncation) |
| `traceability_coverage_omitted` / `_duplicated` | model_output | conditional (bounded retry) |
| `contract_invalid`, `execution_compile_failed`, `prompt_package_invalid`, `checksum_invalid`, `manifest_invalid` | contract | terminal (non-retryable without changed input/code) |
| `invalid_response_schema`, `structural_validation_failed` | business_logic | terminal (deterministic; retrying unchanged input cannot pass) |
| `*_coverage_mismatch`, `unsupported_claims_coverage_mismatch`, `inspector_challenge_coverage_mismatch`, `remediation_scaffold_coverage_mismatch`, `stage11_structural_inputs_missing` | business_logic | terminal |
| `missing_context_variable`, `unsupported_runtime` | contract | terminal |
| `authentication_error` *(new; today masked as `api_error`)* | infrastructure | terminal (config change required) |
| `platform_kill_exhausted_retries` | operational | terminal (already exhausted) |

**Note on §6.2 conflict:** both reason codes for a schema-invalid model output are normalized to
**business_logic / terminal** (such output cannot pass on identical re-run). `invalid_response_schema`
is a **worker-only** reason (emitted by `runtime/runtime.ts`, surfaced by `irr-job-worker`); the
`irr-stage-engine` schema-validation stage emits a **different** reason, `structural_validation_failed`,
which it **already** treats as terminal. So on the authoritative path (`irr-stage-engine`, D-1/§6.7)
this normalization changes **nothing** — the step-3 parity analysis confirmed the engine never emits
`invalid_response_schema` and its `structural_validation_failed` behavior is unchanged. The actual
§6.2 correction (making the retryable→terminal flip) therefore lands **only** in `irr-job-worker`
(step 4), not in the engine (step 3). *(v1.1 correction — see header; the prior wording implied the
engine handled `invalid_response_schema` itself, which the step-3 grounding disproved.)*

### 9.3 Mechanism (contract-first, per §6.5)

One canonical definition compiles to a generated classifier that both execution paths import
as a copy, verified against the source by an M7-style gate. No consumer re-derives the map
(CW-ARCH-001 §9.3).

## 10. Retry-Policy Evaluation Design (M7A-03…M7A-11)

A single **policy evaluator** takes `(reason, category, attempt, context)` and returns a
decision: `{ retry: boolean, delayMs: number, terminal: boolean, reason_normalized, category }`.

- **M7A-03 central evaluation:** both paths replace their inline/hardcoded retry decisions
  (§6.2) with a call to the evaluator. It is the only place retryability is decided.
- **M7A-04 evidence-based limits:** per-category attempt ceilings are **derived from observed
  failure/recovery telemetry** (M7A-12), not fixed literals. Because that telemetry does not
  exist yet (§6.4), the milestone **bootstraps** with the current `max_attempts = 6` as an
  explicit, recorded provisional and tightens per category once telemetry is collected — the
  bootstrap and its provenance are documented, satisfying "not arbitrary."
- **M7A-05 exponential backoff / M7A-06 jitter:** `delayMs = base · 2^(attempt-1)` capped,
  plus bounded random jitter, for operational (transient) categories only. Terminal/
  deterministic categories get `delayMs = 0, retry = false`. **Per D-2 (a), `delayMs` is
  computed and recorded (telemetry) but not enforced by the claim path in M7A** — the
  existing immediate re-queue is unchanged; honoring the delay is Milestone 8. This keeps the
  resilience *decision* in M7A and the scheduling *mechanism* in M8.
- **M7A-07 rate-limit:** subclassify provider 429; honor `Retry-After` when present (use it as
  `delayMs`); category operational.
- **M7A-08 timeout / M7A-09 network:** already emitted as `generation_timeout` / `network_error`
  (§6.3) — mapped operational/retryable with backoff. M7A formalizes their bounded ceiling.
- **M7A-10 circuit-breaker where justified:** a breaker keyed by provider/dependency that,
  after a threshold of consecutive operational failures in a window, short-circuits new
  attempts to a fast terminal-with-reason instead of hammering a down provider. "Where
  justified" is honored literally: the breaker ships **only if** operational telemetry (M7A-12)
  shows correlated provider outages; otherwise it is specified but gated off (recorded per
  §7.3 "where justified"). Breaker **state** lives in a dedicated table (D-3, §20) since edge
  functions are stateless.
- **M7A-11 terminal-error normalization:** every terminal outcome is normalized to a single
  shape `{ category, reason_normalized, message, terminal: true }` written consistently to
  `classified_failure` + a new `error_category`, and onto `irr_jobs.error_json` — so a
  terminal failure is explicit and diagnosable (§7.6) and maps onto CW-EXEC-001 §24 terminal
  state without redefining it.

## 11. Implementation Architecture — repository paths & file-by-file plan

Grounded in §6.5 (the compiler precedent) and the real function layout.

```
resilience/                              ⊕ canonical resilience source (mirrors compiler/)
├─ taxonomy.yaml                         ⊕ M7A-01/02: reason → category → base policy (single
│                                            source of truth; the ONLY place the map is defined)
├─ policy.yaml                           ⊕ M7A-04/05/06/07/10: category → {ceiling, backoff base/
│                                            cap, jitter, honor_retry_after, breaker cfg}; values
│                                            annotated with provenance (bootstrap vs evidence)
├─ compile.js                            ⊕ compiles taxonomy.yaml + policy.yaml → generated/
├─ verify.js                             ⊕ M7-style gate: byte-verify generated copies vs source
├─ classify.ts                           ⊕ classify(reason) → {category, reason_normalized}
├─ evaluate-policy.ts                    ⊕ M7A-03: evaluate(reason, attempt, ctx) → decision
└─ generated/
   └─ resilience-generated.ts            ⊕ committed generated artifact (the diff target)

edge-functions/irr-stage-engine/
├─ resilience-generated.ts               ⊕ COPY of resilience/generated/ (like contract-generated.ts)
└─ index.ts                              △ replace inline `retryable: …` decisions (≈L211–828)
                                            with evaluate(); write error_category; apply delayMs
edge-functions/irr-job-worker/
├─ resilience-generated.ts               ⊕ COPY of the same generated artifact
├─ index.ts                              △ replace `RETRYABLE_STAGES` set with evaluate()
└─ pipeline.ts                           △ surface reason/category from pipeline results
edge-functions/runtime/                  △ (read-only classification alignment; RuntimeIssue.reason
                                            already matches — no behavior change to the pure runtime)

tests/
├─ resilience-classification/            ⊕ M7-style certification: authored (reason → expected
│  └─ cases/*.json                          category + expected decision) canonical cases; NO
│                                            model call; asserts the evaluator, incl. the §6.2
│                                            conflict resolution and the 429/auth subclassification
└─ regression-corpus/cases/              △ add resilience terminal/transient cases (corpus 1.1.0→1.2.0)

verification/
└─ (reuse) verify.js gate policy         △ M7-01 detect-changes: resilience/ edit → taxonomy gate
                                            + affected-stage cert; add `verify:taxonomy` script

supabase/migrations/
└─ 2026XXXX_m7a_resilience_telemetry.sql ⊕ additive: error_category column(s) + retry telemetry
                                            (+ circuit-breaker state table iff D-3 adopts it)
```

**Design constraints (CW-ARCH-001):** the taxonomy source is the single source of truth;
`irr-stage-engine` / `irr-job-worker` are *consumers* of the generated classifier and never
redefine a mapping (§9.3). No consumer keeps its own retry table after M7A.

## 12. Build Sequence (each step independently gated)

1. **Taxonomy + policy source + compiler + verify gate (M7A-01/02).** `resilience/taxonomy.yaml`,
   `policy.yaml`, `compile.js`, `verify.js`, generated artifact. Gate: generated output stable
   across two runs; `verify:taxonomy` byte-verifies copies; a corrupted taxonomy fails it.
2. **Central evaluator + classification certification (M7A-03/11).** `classify.ts`,
   `evaluate-policy.ts`; `tests/resilience-classification/` authored cases (incl. §6.2 conflict,
   429/auth subclassification, terminal normalization). Gate: certification green; deterministic
   inputs → deterministic decisions.
3. **Consumer refactor — stage engine (M7A-03/05/06/08/09/11).** Replace inline decisions with
   `evaluate()`; write `error_category`; apply `delayMs` per D-2. Gate: existing stage
   certification + smoke stay green; no behavior change for already-correct paths.
4. **Consumer refactor — job worker (M7A-03).** With D-1 resolved (§6.7), `irr-stage-engine`
   is authoritative and takes priority (step 3). For `irr-job-worker`: confirm it is truly
   idle, then either **align** it to `evaluate()` (removing `RETRYABLE_STAGES`) or **retire**
   it — but it must not remain a live path carrying the contradictory classifier. Gate: no
   execution path retains its own retry decision; engine and any live worker return identical
   decisions for identical reasons.
5. **Rate-limit + telemetry (M7A-07/12).** 429/`Retry-After` subclassification; retry/failure
   telemetry (attempts + delays measurable). Gate: a simulated 429 is classified operational/
   retryable with the honored delay; telemetry rows show attempts and delays.
6. **Circuit-breaker (M7A-10), gated on evidence.** Ships enabled only if M7A-12 telemetry
   justifies it; otherwise specified + off. Gate: breaker opens on threshold in a fault-injection
   test and fast-fails with a normalized terminal reason.

## 13. Migration Sequence (schema/contract/data)

- **Contract changes:** none to `compiler/contract.yaml` (IRR field contract is unchanged).
  The *taxonomy* is a new canonical source, not a change to the IRR contract.
- **Schema (one additive migration, M7A-12):** add `error_category text` to `irr_stage_runs`
  (and mirror onto `irr_jobs.error_json` payload); add retry-telemetry so attempts and delays
  are measurable (either columns `retry_delay_ms` / `retry_history jsonb` on `irr_stage_runs`,
  or a dedicated `m7a_retry_events` table — D-4). **If D-3 adopts a persisted breaker**, add a
  `m7a_circuit_state` table. All additive, explicit RLS on any new table (M7 precedent), no
  ALTER that drops/rewrites existing IRR columns. Lands after the M7 isolation migration
  (`…000007`).
- **The backoff-timing question (D-2):** if the claim path must *honor* `delayMs`, a
  `next_attempt_at` column + a claim-filter change is required — that touches scheduler
  behavior and is therefore a **bounded, explicitly-flagged** additive change, or deferred to
  M8. Resolved in §20 before build step 3.
- **Data:** no backfill; new columns default null/empty for historical rows.

## 14. Rollout Sequence

1. Land build steps 1–6 behind their gates on a feature branch; open PR to `main`.
2. `npm run verify` (M7) runs locally + CI advisory; `verify:taxonomy` + resilience
   certification included via gate selection.
3. Re-deploy only the functions whose bytes changed (`irr-stage-engine`, `irr-job-worker`) with
   their refreshed `resilience-generated.ts` copies; verify copy == source at deploy.
4. Observe retry/failure telemetry in production for a defined window; **tighten M7A-04 limits
   and decide M7A-10 from that evidence** (the evidence-based step the metric demands).
5. Record closure evidence (Acceptance Report per §4A.2) once §7.6 metrics are met.

## 15. Telemetry (M7A-12)

Every attempt records: `reason`, `error_category`, `attempt`, computed `delayMs`, and terminal
vs retried outcome — so "retry attempts and delays are measurable" (§7.6) is literally true and
so M7A-04 limits and M7A-10 can be set from evidence. Emitted onto the existing stage/job rows
plus (D-4) an optional dedicated events table for aggregate queries.

## 16. Verification Checkpoints (per build step)

- **CP-A1 (taxonomy):** generated artifact byte-stable across two runs; copies byte-match
  source; corrupted taxonomy fails `verify:taxonomy`.
- **CP-A2 (classification):** authored cases certify reason→category→decision, incl. the §6.2
  conflict and 429/auth subclassification; deterministic.
- **CP-A3 (stage-engine refactor):** stage certification + smoke stay green; classification is
  now sourced centrally (grep shows no inline `retryable:` decision remains).
- **CP-A4 (worker refactor):** engine and worker return identical decisions for identical
  reasons; `RETRYABLE_STAGES` removed.
- **CP-A5 (rate-limit + telemetry):** simulated 429 → operational/retryable with honored delay;
  telemetry shows attempts + delays.
- **CP-A6 (circuit-breaker):** fault injection opens the breaker → fast normalized terminal; off
  cleanly when unjustified.

## 17. Acceptance Criteria (mapped to §7.6 success metrics)

- **A-01 (§7.6):** Retry behavior is controlled **centrally** — one evaluator; no inline or
  per-path retry decisions remain (verified by CP-A3/CP-A4 + a static check).
- **A-02:** Transient failures **normally recover without manual requeue** — operational
  categories retry with backoff/jitter within their ceiling (CP-A5; production window §14.4).
- **A-03:** Deterministic failures are **not retried unchanged** — contract/business_logic
  categories are terminal; a schema-invalid or contract-invalid input is not re-attempted
  (CP-A2).
- **A-04:** Retry **attempts and delays are measurable** (M7A-12 telemetry; CP-A5).
- **A-05:** Terminal failures remain **explicit and diagnosable** — normalized
  `{category, reason_normalized, message, terminal}` on stage + job rows (M7A-11; CP-A2).
- **A-06:** Circuit-breaking **exists where operational evidence justifies it** — shipped iff
  telemetry supports it, else specified and gated off with the evidence recorded (M7A-10; CP-A6).
- **A-M1 (evidence, not arbitrary):** every concrete retry limit/backoff value carries recorded
  provenance (bootstrap-from-current-behavior or telemetry-derived), never a bare literal.

## 18. Non-Acceptance Conditions

- **N-01:** Retryability is still decided in more than one place, or a consumer keeps its own
  retry table (centralization not achieved).
- **N-02:** A taxonomy copy in a function drifts from the canonical source (no verify gate, or
  gate not run).
- **N-03:** A deterministic failure (contract/schema/business_logic) is retried unchanged.
- **N-04:** A transient failure (timeout/network/429) is treated as terminal (e.g. 429 left as
  unmapped `api_error`).
- **N-05:** Retry limits are arbitrary fixed literals with no recorded provenance (violates
  M7A-04 / A-M1).
- **N-06:** Backoff/jitter absent for operational retries, or applied to deterministic ones.
- **N-07:** Terminal failures are not normalized / not diagnosable (no category, inconsistent
  shape).
- **N-08:** Retry attempts/delays are not measurable (telemetry missing).
- **N-09:** Circuit-breaker ships **without** operational evidence (violates "where justified"),
  or a real justified provider-outage case is left with no breaker specified.
- **N-12 (scope creep):** Any Milestone 8 / §7.7-excluded work is introduced — scheduler
  redesign, cron changes, worker-owned execution, changes to claim/re-queue/reclaim/deadline
  mechanics beyond an additive, flagged `next_attempt_at`, checkpointing removal, or unrelated
  latency optimization.
- **N-13 (governance):** Implementation began before this DR was approved (§4A), or a workflow
  was changed without an approved Execution Specification (CW-ARCH-001 §9.9).

## 19. Key Risks

- **R-01 Scope creep into M8 (highest).** Retries are re-queue-driven and entangled with the
  claim/reclaim machinery (§6.2/§6.6); honoring backoff timing tempts a scheduler change.
  *Mitigation:* **D-2 confirmed to record-only** — M7A computes/records the decision and makes
  **no** claim-path change; N-12 blocks acceptance if crossed.
- **R-02 Two execution paths.** *Resolved by D-1 (§6.7):* `irr-stage-engine` is authoritative
  and is the primary centralization target; `irr-job-worker` is not current traffic and is
  align-or-retire (§12 step 4), so the refactor is neither wasted on a live path nor risking a
  contradictory classifier left running.
- **R-03 Evidence-before-limits chicken/egg.** M7A-04 wants telemetry that doesn't exist yet.
  *Mitigation:* ship telemetry first (step 5 feeds a bootstrap), record provisional provenance,
  tighten in rollout §14.4 — A-M1 accepts documented bootstrap.
- **R-04 Changing `invalid_response_schema` behavior (§6.2).** *De-risked by D-1 (§6.7):* the
  authoritative path (`irr-stage-engine`) already treats it as terminal, so normalization does
  not change live behavior; the change is confined to the non-authoritative `irr-job-worker`.
  *Mitigation:* still add a regression corpus case; the correction is intended and verified,
  not silent.
- **R-05 Circuit-breaker state in stateless edge functions.** A breaker needs shared state.
  *Mitigation:* D-3 — persist in a dedicated table or defer the breaker; do not fake it in
  per-invocation memory.
- **R-06 Provider-error opacity.** `api_error` currently collapses 429/5xx/auth. *Mitigation:*
  subclassify from provider status/body (M7A-07); cases in CP-A5.
- **R-07 Taxonomy copy drift.** Same class of risk M7 solved for the contract. *Mitigation:*
  reuse the M7 verify-gate pattern (CP-A1).

## 20. Open Decisions (must be settled before the affected build step)

- **D-1 — RESOLVED (owner, 2026-07-15): `irr-stage-engine` is production-authoritative.**
  Empirical basis in §6.7 (per-stage `irr_stage_runs` writes; 31 rows/24 h; active
  stage-by-stage processing of a live job). Centralization lands in `irr-stage-engine` first;
  `irr-job-worker` is align-or-retire (§12 step 4). The `invalid_response_schema` correction
  matches the live path's existing terminal behavior (§9.2).
- **D-2 — CONFIRMED (owner, 2026-07-15): option (a) — record-only.** M7A computes and records
  `delayMs`; the claim path does not wait on it (immediate re-queue unchanged); honoring the
  delay is Milestone 8. No `next_attempt_at` claim-filter change ships in M7A. Locked in §8 /
  §10 (M7A-05). This is the boundary N-12 guards.
- **D-3 — Circuit-breaker state store.** Dedicated `m7a_circuit_state` table vs defer the breaker
  entirely until evidence justifies it. *Before build step 6.*
- **D-4 — Retry telemetry shape.** Columns on `irr_stage_runs` vs a dedicated `m7a_retry_events`
  table. *Before the migration (step 5).*
- **D-5 — Bootstrap retry ceilings.** Confirm `max_attempts = 6` (current) as the recorded
  provisional per category until telemetry tightens it. *Before build step 3.*

## 21. What this milestone deliberately does NOT change

The IRR field contract; the 15-stage sequence; checkpoint/resume; the claim/re-queue/reclaim/
deadline mechanics and cron cadence (M8); the pure runtime's behavior. M7A changes **where the
classification and retry decision is made and how failures are recorded** — not the pipeline's
work or the scheduler's mechanics.
