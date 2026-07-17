# CW-MDR-008 — Milestone 8 Design Review

**Status:** DRAFT v0.1 — for Milestone Owner review. Implementation **NOT AUTHORIZED**
(CW-GOV-001 §4A gate not yet passed).
**Milestone:** 8 — Execution Engine Optimization (CW-GOV-001 §8)
**Author:** Claude Code (implementer)
**Date drafted:** 2026-07-17
**Approval authority:** CEO / Milestone Owner (per CW-GOV-001 §12). The author does **not**
self-authorize; this Design Review precedes and gates implementation. It authorizes nothing.

**Governing scope origin:** Milestone 6 closure split (2026-07-12) carved execution-engine
optimization out of Milestone 6 into this milestone; CW-GOV-001 §8 is the authoritative spec.

---

## 1. Purpose

Milestone 8 replaces **cron-driven** stage advancement with **worker-owned continuous
execution** to cut end-to-end IRR generation latency, **without** weakening validation,
checkpointing, resumability, or reliability (CW-GOV-001 §8.2). This Design Review maps the
current execution engine as it actually runs today (grounded in the repo and the live cron
configuration), proposes the worker-owned model, shows how checkpoint/resume is preserved
byte-for-byte in behavior, scopes safe parallelization of independent stages, assesses the
risk of the cron→recovery-only transition, and maps acceptance tests to the §8.5 success
metrics. It authorizes nothing; it precedes implementation.

The central problem, stated concretely from the current code (§6): a job advances **one stage
per cron tick**, and stage N's completion does **not** trigger stage N+1 — only the next tick
does. With ~15 stages that is **≥15 poll gaps of pure idle latency** per job, and it multiplies
under concurrency (one job advances per tick, round-robin). M8 removes the poll gap from normal
execution and keeps cron only as a recovery safety net.

## 2. Governing References

- **CW-GOV-001 §8** — the authoritative objective, scope, required architecture, success
  metrics, and prohibitions for Milestone 8 (governing spec).
- **CW-GOV-001 §4A** — Milestone Design Review gate: no implementation before approval.
- **CW-GOV-001 §12** — closure/approval authority (Milestone Owner).
- **CW-MDR-007A (Milestone 7A, closed)** — the resilience foundation this milestone
  **consumes unchanged**: the centralized error taxonomy, `decideFailure()`/`evaluate()`
  retry-policy evaluator, and the specified-but-off circuit breaker. M8 respects these
  decisions; it does **not** redefine them (§8 exclusions). M7A **deferred honoring the
  recorded backoff delay to Milestone 8** (CW-MDR-007A D-2, §20) — that handoff lands here.
- **CW-MDR-007 (Milestone 7, closed)** — the verification toolchain M8 **uses, not extends**:
  `npm run verify` gate selection, stage certification, the immutable regression corpus, smoke.
- **CW-ARCH-001 §9.9 / CW-EXEC-001** — no workflow/regulatory-reasoning change without an
  approved Execution Specification. M8 changes **when/where** stages run, never **what** a stage
  reasons or emits.
- **Milestone 6 closure evidence** — checkpoint/resume (incl. the intra-stage batch replay
  historically called "Stage 11") is a **non-negotiable carryover**; §11 pins the exact
  mechanism M8 must preserve.

## 3. Traceability Spine (every §8.3 sub-requirement → an ID)

**Scope (§8.3):**

| ID | §8.3 requirement |
|----|------------------|
| M8-01 | Replace cron-driven normal stage advancement |
| M8-02 | Worker-owned consecutive execution (run next eligible stage immediately) |
| M8-03 | Retain cron (or equivalent) for **recovery only** |
| M8-04 | Preserve stage **and** batch checkpoints |
| M8-05 | Preserve stalled-job reclamation |
| M8-06 | Assess independent stages for **safe** parallel execution |
| M8-07 | Measure baseline + post-change latency (median / P95) |
| M8-08 | Measure throughput |
| M8-09 | Measure recovery behavior |
| M8-10 | Eliminate artificial inter-stage waiting |

**Derived prerequisites (net-new, required to satisfy the above safely):**

| ID | Requirement | Serves |
|----|-------------|--------|
| M8-11 | A **declared, verified** stage dependency graph (single source of truth) | prerequisite for M8-06 (no parallelizing on inference alone) |
| M8-12 | Consume M7A taxonomy/retry/breaker **unchanged**; worker **honors** recorded backoff (M7A D-2 handoff) and **consults** the breaker | M8-02, M8-06 (respect resilience, don't bypass) |

**Required architecture (§8.4) → realized in M8-02/03/04 (§9, §11, §12).**
**Success metrics (§8.5) → acceptance A-01…A-06 (see §19).**

## 4. Objective (CW-GOV-001 §8.2)

Reduce end-to-end IRR generation latency **without weakening validation, checkpointing,
resumability, or reliability** — by having the worker run consecutive stages immediately on
completion of the prior stage, parallelizing genuinely independent stages, and demoting cron to
recovery-only, while preserving every checkpoint and reclamation behavior that exists today.

## 5. In-Scope Components (CW-GOV-001 §8.3, full)

All of §8.3: replace cron-driven normal stage advancement; worker-owned consecutive execution;
cron/equivalent for recovery only; preserve stage and batch checkpoints; preserve stalled-job
reclamation; assess independent stages for safe parallel execution; measure baseline and
post-change latency; measure throughput; measure recovery behavior; eliminate artificial
inter-stage waiting.

## 6. Current-State Grounding (what exists today — verified against the repo and live cron)

This section is drawn from the current production code and the live pg_cron configuration, not
assumptions. Canonical execution engine: `edge-functions/irr-stage-engine/index.ts`.

### 6.1 Cron-driven, one-stage-per-tick execution (the latency source)

Execution is advanced **only** by a pg_cron tick that POSTs an empty body `{}` to the
`irr-stage-engine` edge function; there is no self-reinvoke and no multi-stage loop. Per tick
the engine (`index.ts:885-940`): runs `stallReclaim()`; claims one job via
`rpc/claim_next_active_irr_job`; computes `nextStage = highestCompleted + 1` from the completed
`irr_stage_runs` rows (`:894-898`); upserts that one stage row to `running`; runs it **detached**
via `EdgeRuntime.waitUntil(runStage(...))` (`:937`); and returns HTTP 202 `stage_processing`
**immediately** (`:939`). `runStage` marks the stage `completed` with `output_json`
(`:829-845`) but does **not** invoke the next stage. **Advancement happens only on the next
tick** — a full 15-stage job needs ≥15 ticks. This poll gap is the artificial inter-stage wait
M8-10 removes.

### 6.2 The claim + resume machinery (what already makes worker-owned execution safe)

`claim_next_active_irr_job` (`supabase/migrations/20260711130859_fix_claim_order_true_round_robin.sql:17-37`):
eligible = `status IN ('queued','running')`; **skips** any job whose current stage row is
`running` and younger than `380_000ms` (prevents double-execution of a mid-flight stage);
`ORDER BY j.updated_at ASC ... FOR UPDATE SKIP LOCKED` (least-recently-touched first, true
round-robin); sets the claimed job `status='running', updated_at=now()`. The `FOR UPDATE SKIP
LOCKED` claim + the 380s in-flight guard are exactly the primitives that let a worker (or a
recovery sweep) pick up a job **without** racing another executor — M8 preserves them verbatim.

### 6.3 Checkpointing today — stage-level + intra-stage batch (the non-negotiable carryover)

Two levels of checkpoint exist and **both must be preserved (M8-04)**:

1. **Stage-level.** Each completed stage persists its full return value to
   `irr_stage_runs.output_json` (`20260710113620_create_irr_stage_runs.sql:12`), keyed
   `UNIQUE(job_id, stage)` (`:18`). Resume reloads all completed rows into `prior[stage]` and
   restarts at `highestCompleted + 1` (`index.ts:894-898`) — completed stages are **never**
   re-run.
2. **Intra-stage batch ("Stage 11 replay").** The map-reduce AI stages **7–11**
   (`claim_status`, `evidence_traceability`, `unsupported_claims`, `inspector_challenge`,
   `remediation_scaffold`) checkpoint per batch to `irr_stage_runs.checkpoint`
   (`20260711094704_add_stage_run_checkpoint.sql:1`) and resume from the last checkpointed batch:
   `const resumed = ctx?.checkpoint?.partials; ... for (let b = partials.length; b < batches.length; b++)`
   (e.g. stage 11 `index.ts:664-670`; same at `:329/:411/:509/:585`), saving via
   `ctx.saveCheckpoint(...)` (`:699`, impl `:808-813`). After merge, results are **de-duplicated**
   by `JSON.stringify` and a **coverage check** enforces exactly one output per gap
   (`remediation_scaffold_coverage_mismatch`, `:702-721`).

**Naming caveat (must be stated to avoid a wrong fix):** the historical "Stage 11" label is a
carryover, not a fixed index. In the current code `remediation_scaffold` is stage **11** and
`deterministic_assembly` is stage **12** (`index.ts:654`, `:730`); a stale id
`stage11_structural_inputs_missing` lives in the stage-**12** code (`:733`). The documented
"Stage 11 Nondeterministic Duplicate Scaffold" defect (`CW-GOV-001` backlog) is **Backlog /
did-not-reproduce-on-clean-replay**; the dedup + coverage-mismatch guard above is its current
in-code mitigation. M8 preserves this mechanism; it does not attempt to fix that backlog defect.

### 6.4 The stage dependency structure is real but UNDECLARED (the parallelization gap)

There are 15 stages, canonical as the `STAGES` array literal (`index.ts:193-791`). **No
dependency graph is declared anywhere in the repo** — no `dependsOn`, no edge list, no
stage-spec of dependencies (confirmed absent). Dependencies exist only **implicitly**, as
`prior[N]` reads inside each stage's `run()`. Inferred from those reads:

- Serial chains: **1→2→3** (compile chain) and **12→13→14→15** (assembly/validation; broad
  fan-in at 13/14, `index.ts:743`, `:760-771`).
- **Independent band: stages 7, 8, 9, 10, 11** — each reads only stage 4–6 outputs (principally
  `prior[6].gapFlags_list`) and **none reads a sibling's output**; all fan into 12/13.

This band is the natural parallelization target — but the dependencies are **inferred, not
enforced**, so a change to one stage's `prior[...]` usage would silently invalidate the graph.
**M8 must first make the graph explicit and verified (M8-11) before parallelizing on it
(M8-06).** Confidence in the reads is medium-high; confidence in the *safety of reordering*
without a declared, verified graph is low. This gap is the primary correctness risk (§21 R-03).

### 6.5 M7A integration points already present (consume, don't redefine)

- **Single decision site.** `decideFailure()` is imported (`index.ts:3`) and called once, in the
  `runStage` catch handler (`index.ts:853`), driving normalized reason/category, retry
  (`status='queued'`) vs terminal (`failed` on stage + job), and `m7a_retry_events` telemetry
  (`:866`). It wraps `evaluate()` (`resilience/decide-failure.ts` → `resilience/evaluate-policy.ts`).
- **Backoff recorded, not enforced.** `delay_ms` is computed but the engine never waits on it
  (retry is a plain re-`queued` that waits for the next tick). Honoring the delay was explicitly
  **deferred to M8** (CW-MDR-007A D-2). Now that the worker owns timing, M8-12 can honor it.
- **Breaker shipped OFF and never invoked.** `BREAKER.enabled === false`
  (`.../resilience/generated/resilience-generated.ts`); `evaluate-policy.ts` hard-gates it off;
  a grep of `index.ts` for `circuitOpen|breaker|BREAKER` returns **none** — it is
  specified-but-dormant, and its state store (`m7a_circuit_state`) is deferred/not built. M8
  **wires the worker to consult the breaker** so parallel dispatch respects it *if/when* enabled,
  without flipping it on (enablement stays evidence-gated — §22 D8-4).

### 6.6 Repo/prod scheduler drift — a real finding M8 must reconcile

The committed migration schedules the engine tick at `'* * * * *'` = **1 minute**
(`20260710113839_schedule_stage_engine_cron.sql:3`). **The live production cron does not match
it:** `cron.job` jobid **138 `irr-stage-engine-tick` is scheduled `30 seconds`, active** (verified
by direct read of the production `cron.job` table, project `balkvbmtummehgbbeqap`), with a 150s
statement timeout. So the deployed schedule was changed **out of band** (not via a committed
migration) to sub-minute cadence, and `irr-job-worker/DEPRECATED.md:10` ("every 30s") matches
**live**, not the repo. This drift matters because M8 rewrites exactly this scheduler:
reconciling the migration to the deployed reality (and never hand-editing prod again) is an
explicit M8 task (§15, §21 R-06). A second cron, `runtime-worker-tick` (every 1 min → the generic
`runtime-worker`, not the IRR pipeline), is unrelated and out of scope.

### 6.7 What does NOT exist today (net-new in M8)

- Any mechanism to run stage N+1 without waiting for a cron tick (continuous execution).
- Any concurrent/parallel stage execution (strictly one stage per invocation).
- Any **declared** stage dependency graph (only implicit `prior[N]` reads).
- Any enforcement/sleep on the recorded `delay_ms` backoff.
- Any end-to-end latency / throughput / recovery-time measurement harness.
- A recovery-*only* cron role (today the single cron is both driver and recovery).

## 7. (reserved)

## 8. Explicit Exclusions (CW-GOV-001 §8.6 + milestone boundaries)

Per §8.6, M8 must **not**: remove validation to gain speed; eliminate checkpoints; **combine
reasoning stages solely to reduce calls** (parallelize distinct stages — never merge them);
weaken traceability; or change regulatory reasoning without an approved Execution Specification
change. Additional boundaries:

- **No change to the M7A resilience contracts** — the taxonomy, `decideFailure()`/`evaluate()`
  policy, and breaker interface are **consumed unchanged**. M8 may honor the recorded backoff and
  consult the breaker (execution behavior), but must not redefine categories, reasons, policy
  values, or the decision shape.
- **No change to M7 verification tooling** — M8 **uses** `npm run verify`, stage certification,
  and the regression corpus; it does not extend or fork them (it may add new *M8* gates that plug
  into the existing orchestrator, mirroring how M7A added its four gates).
- **No product-service / AI-Services development** — that roadmap is post-M8.
- **No change to what any stage reasons or emits** — the IRR field contract, the 15-stage
  sequence identities, and each stage's inputs/outputs are unchanged. M8 changes **when and where**
  stages run, not their content.

## 9. Proposed Worker-Owned Continuous Execution Model (M8-01/02/10)

### 9.1 The normal execution loop (CW-GOV-001 §8.4)

Evolve `irr-stage-engine` **in place** (it is the production-authoritative path per CW-MDR-007A
D-1; keeping the function name avoids cron/deploy churn) into a **continuous worker**. On
invocation it claims one job (unchanged claim RPC, §6.2) and then **loops** instead of running a
single stage:

```text
claim job (FOR UPDATE SKIP LOCKED, 380s in-flight guard)   ── unchanged
  ↓
repeat:
  nextEligible = eligible stage(s) from the DECLARED graph, given completed rows   (M8-11)
  if none remain            → mark job completed, persist result_json, exit
  run nextEligible (one stage, or a parallel band per §10), through runStage
  validate + persist checkpoint (output_json / batch checkpoint)   ── unchanged (§11)
  on retryable failure      → apply M7A decision, honor recorded backoff (M8-12), continue
  on terminal failure       → mark job failed, exit
  if invocation time-budget hit → hand off (see §9.2) and exit
```

This is exactly the §8.4 required architecture ("Run next eligible stage **immediately**"). The
per-stage execution, validation, and checkpoint-write are the **same** `runStage` machinery used
today — only the *driver* changes from "next cron tick" to "next loop iteration." The artificial
inter-stage wait (§6.1) is eliminated (M8-10).

### 9.2 Continuation across the edge-function wall-clock limit

A single edge invocation cannot run all 15 stages (many are multi-second/minute AI calls; the
current statement timeout is 150s). The worker therefore runs a **soft time budget** (e.g. stop
starting new stages past ~N seconds of the wall limit) and, when hit, **hands off** to continue
the same job. Two hand-off mechanisms are on the table (D8-1): **(a) self-reinvoke** — fire a
non-blocking `net.http_post`/`fetch` to itself to continue immediately (lowest latency), with the
recovery cron as the safety net; or **(b) return and let the recovery cron re-launch** (simpler,
but reintroduces a poll gap at each hand-off). Either way resumability is **inherited** from
§6.3: the next invocation resumes at `highestCompleted + 1` with `prior` and any intra-stage
`checkpoint` intact. Recommended: (a) with (b) as fallback.

### 9.3 First-touch: how a freshly queued job starts

Today a new `queued` job waits for the next tick. To avoid reintroducing latency at enqueue,
`generate-irr` (the enqueue entry point, `edge-functions/generate-irr/index.ts`) should **kick a
worker invocation** (fire-and-forget) immediately after inserting the `queued` row, with the
recovery cron as the fallback that catches any job that was never kicked (D8-2). No change to the
job's contract or payload.

## 10. Parallel Execution of Independent Stages (M8-06, gated on M8-11)

### 10.1 The declared dependency graph is a prerequisite

Because dependencies are inferred-only today (§6.4), M8 **first** introduces a **declared,
verified stage dependency graph (M8-11)** as a single source of truth — a manifest listing each
stage's upstream inputs, verified against the actual `prior[N]` reads by a new gate (mirroring the
M7A taxonomy verify-gate pattern: canonical source → consumer → byte/behavior verify). **No stage
is parallelized until the graph is declared and its gate is green.** Parallelizing on inference
alone is a non-acceptance condition (§20 N-04).

### 10.2 The parallel band

Given the declared graph, the initial safe parallel set is **stages 7–11** (§6.4): each depends
only on stages 4–6 and none on a sibling; they join at stage 12/13. The worker runs the band
concurrently (bounded concurrency), each stage still writing its own `irr_stage_runs` row and its
own intra-stage `checkpoint`; the join waits for **all** band members to reach `completed` before
starting stage 12. Serial chains (1→2→3, 12→13→14→15) are unchanged. Stages are run **concurrently,
never merged** (§8.6 prohibition).

### 10.3 Concurrency, provider limits, and the M7A breaker

Parallel dispatch concentrates model-provider load, raising 429/5xx exposure. The worker must:
(a) apply a **concurrency cap** (D8-4); (b) route every failure through the existing
`decideFailure()` (unchanged) so 429→rate_limit/backoff and network/5xx→retryable behave exactly
as M7A specified; (c) **consult the circuit breaker** before dispatch so that, *if* enabled, an
open circuit fast-fails the band with the normalized terminal reason. The breaker **stays
shipped-off** (enablement remains evidence-gated, §22 D8-4); M8 only wires the consult path and,
*only if* enablement is chosen, adds the deferred `m7a_circuit_state` store — that decision is
out of this milestone's default scope.

## 11. Checkpoint / Resume Preservation (the non-negotiable — M8-04/05)

M8 makes **no change** to: the `irr_stage_runs` schema, the `checkpoint jsonb` batch-partials
mechanism, the `nextStage = highestCompleted + 1` resume rule, the post-merge dedup +
coverage-mismatch reconciliation (`index.ts:702-721`), the 380s in-flight guard, or
`stallReclaim` (10-min no-progress → fail). The worker loop calls the **same** persistence and
resume code between stages that the cron model calls once per tick. Concretely:

- **Worker death mid-job** → the recovery cron (§12) re-launches a worker; it resumes at
  `highestCompleted + 1` with `prior` reloaded from `output_json`; no completed stage re-runs.
- **Worker death mid-stage (mid-batch)** → the next run resumes from the last `checkpoint.partials`
  batch; the dedup/coverage guard still enforces one-output-per-gap.
- **Parallel band interrupted** → each band member is an independent `irr_stage_runs` row; only
  the incomplete members re-run; completed members are reloaded. The join re-evaluates completion.

This is proven by the fault-injection acceptance test (A-03/A-05, §18 CP-8.5).

## 12. Recovery-Only Cron (M8-03/05)

Cron is **demoted**: it no longer drives normal progression. Its sole job becomes **detecting and
resuming stalled/orphaned work** — jobs that are `running` but whose worker died (current stage
row `running` older than the in-flight window, or `updated_at` stale) and freshly `queued` jobs
that were never kicked (§9.3 fallback). This reuses the primitives that already exist
(`stallReclaim` `index.ts:795-801`; the 380s guard; `claim_next_active_irr_job`) — the recovery
sweep simply **launches a worker** for an eligible job rather than advancing one stage itself. Its
cadence can relax (e.g. 1–2 min; D8-3) because it is a safety net, not the hot path. **Success
metric §8.5 "cron no longer participates in normal stage progression" is verified by A-02.**

## 13. Implementation Architecture — repository paths & file-by-file plan

- `edge-functions/irr-stage-engine/index.ts` — evolve the single-stage handler into the
  continuous worker loop (§9.1), add the soft-time-budget + hand-off (§9.2), the parallel-band
  executor (§10.2), backoff honoring (M8-12), and breaker consult (§10.3). No change to
  `runStage`'s per-stage logic, validation, or checkpoint writes.
- **New:** a declared stage dependency graph manifest + its verify gate (M8-11) — canonical
  source under e.g. `execution-graph/` (mirroring `resilience/`), with a `verify:graph` gate that
  checks the manifest against each stage's actual `prior[N]` reads and plugs into the M7
  orchestrator (`verification/detect-changes.js` + `verify.js`), exactly as the four M7A gates do.
- `supabase/migrations/` — (1) a migration that **reconciles the cron** to recovery-only cadence
  and supersedes the drifted `…113839` schedule (§6.6); (2) any additive latency/throughput
  telemetry columns/table (M8-07/08/09), all additive with explicit RLS per the M7/M7A precedent.
- `edge-functions/generate-irr/index.ts` — add the fire-and-forget first-touch kick (§9.3); fix
  its stale comment that references `irr-job-worker`.
- `edge-functions/irr-job-worker/` — retire (D8-6): with worker-owned execution defined here, the
  dormant whole-pipeline worker should be removed rather than left as a second, contradictory
  execution concept. (Carried from CW-MDR-007A D-1.)
- **No change** to `resilience/` (M7A contracts), the `compiler/` contract, `tests/regression-corpus/`,
  or the M7 verification harness internals.

## 14. Build Sequence (each step independently gated)

1. **Baseline measurement (M8-07/08/09).** Instrument and record current median/P95 end-to-end
   latency, throughput, and recovery time under the cron model — the "before" the metrics compare
   against. Gate: a baseline report exists with real numbers (no change to execution yet).
2. **Declared dependency graph + gate (M8-11).** Add the manifest and `verify:graph`; wire into
   `npm run verify`. Gate: the manifest matches every stage's `prior[N]` reads; a deliberately
   wrong edge fails the gate.
3. **Continuous worker loop, serial (M8-01/02/10).** Replace one-stage-per-tick with the
   in-invocation loop + soft-budget hand-off; **no parallelism yet**. Gate: stage certification +
   smoke stay green; a full job completes in one (or a few, via hand-off) invocations with **zero
   cron ticks driving it**; resume-after-kill still works.
4. **Recovery-only cron (M8-03/05) + first-touch kick (§9.3).** Demote cron; add the enqueue kick;
   reconcile the drifted schedule. Gate: cron no longer advances a healthy job; an orphaned job
   (worker killed) is detected and resumed within the recovery window; a freshly queued job starts
   without waiting for a tick.
5. **Parallel band (M8-06), gated on step 2.** Run stages 7–11 concurrently with a concurrency
   cap; honor M7A retry/backoff; consult the breaker. Gate: band members run concurrently and all
   join before stage 12; a mid-band kill resumes only the incomplete members; dedup/coverage guard
   holds; provider-429 under load is classified/retried per M7A.
6. **Post-change measurement + acceptance (M8-07/08/09).** Re-measure latency/throughput/recovery;
   compare to step-1 baseline. Gate: typical end-to-end < 5 min; throughput ≥ baseline; reliability
   ≥ baseline; all A-* satisfied.

## 15. Migration Sequence (schema/scheduler/data)

- **Scheduler:** one migration that (a) supersedes the out-of-band-drifted engine tick (§6.6) and
  (b) sets the **recovery-only** cadence. The committed migration becomes the source of truth
  again; no further hand-edits to prod cron.
- **Telemetry (additive only):** latency/throughput/recovery measurement — either additive columns
  on `irr_jobs`/`irr_stage_runs` or a dedicated `m8_execution_metrics` table (D8-5), with explicit
  RLS on any new table (M7/M7A precedent), no ALTER that drops/rewrites existing columns.
- **No change** to `irr_stage_runs` checkpoint columns or `irr_jobs` state columns used by
  resume/reclaim (§11).
- **Data:** no backfill; new telemetry defaults null/empty for historical rows.

## 16. Rollout Sequence

1. Land build steps 1–6 behind their gates on a feature branch; open PR to `main`.
2. `npm run verify` (M7) + the new `verify:graph` (and any M8 gates) run via gate selection.
3. Deploy the evolved `irr-stage-engine` (byte-verified, as in the M7A deploy) and apply the
   scheduler + telemetry migrations. Retire `irr-job-worker` (D8-6).
4. Observe latency/throughput/recovery for a defined production window; confirm §8.5 metrics from
   real traffic (not synthetic alone).
5. Record closure evidence (Acceptance Report per §4A.2) once §8.5 metrics are met. Closure is the
   Owner's decision.

## 17. Telemetry / Measurement (M8-07/08/09)

Record, per job and per stage: stage start/end and `duration_ms` (already present), plus
job-level end-to-end elapsed, queue-wait, hand-off count, parallel-band wall-clock vs sum, retry
count and honored backoff, and recovery events (orphan detected → resumed, with latency). These
make the §8.5 metrics (median/P95 latency, throughput, recovery behavior) **literally measurable**
and provide the before/after comparison the milestone closes on.

## 18. Verification Checkpoints (per build step)

- **CP-8.1 (baseline):** a real median/P95 latency + throughput + recovery-time baseline report
  exists before any execution change.
- **CP-8.2 (graph):** `verify:graph` certifies the manifest against actual `prior[N]` reads; a
  wrong edge fails it; wired into `npm run verify`.
- **CP-8.3 (continuous serial):** stage certification + smoke green; a full job completes with
  **zero cron ticks driving progression**; kill-mid-job resumes at `highestCompleted+1` with no
  re-run and no lost stage.
- **CP-8.4 (recovery-only):** healthy jobs never advanced by cron; an orphaned job is detected and
  resumed within the recovery window; a freshly queued job starts without a tick.
- **CP-8.5 (parallel band):** stages 7–11 run concurrently and join before 12; mid-band kill
  resumes only incomplete members; dedup/coverage guard holds; 429-under-load classified/retried
  per M7A; breaker consult path exercised (fault-injected open → fast terminal) while shipped off.
- **CP-8.6 (metrics):** post-change typical E2E < 5 min; median/P95 documented; throughput ≥
  baseline; reliability ≥ baseline.

## 19. Acceptance Criteria (mapped to §8.5 success metrics)

- **A-01 (§8.5):** Typical IRR generation completes **under 5 minutes** end-to-end (subject to
  provider latency and document scale), with **median and P95 measured and documented** (CP-8.1
  baseline vs CP-8.6).
- **A-02:** **Cron no longer participates in normal stage progression** — a healthy job advances
  entirely by the worker; cron only recovers stalled/orphaned work (CP-8.3/CP-8.4).
- **A-03:** **Worker failure resumes from the latest accepted checkpoint** — kill mid-job and
  mid-batch both resume with no re-run of completed work and no lost stage; the dedup/coverage
  guard holds (CP-8.3/CP-8.5).
- **A-04:** **Throughput ≥ the Milestone 6 baseline** — measured under comparable load (CP-8.6).
- **A-05:** **Reliability ≥ the Milestone 6 architecture** — failure/retry rate not worse than
  baseline; every checkpoint/reclamation behavior preserved; resilience decisions still routed
  through the unchanged M7A evaluator (CP-8.4/CP-8.5/CP-8.6).
- **A-06:** **No artificial inter-stage waiting remains** — stage N+1 (or the parallel band)
  starts immediately on stage N's completion within the worker, not on a poll boundary (CP-8.3).
- **A-M1 (safety, not just speed):** parallelization is driven by a **declared, verified**
  dependency graph, never inference; validation, traceability, and regulatory reasoning are
  unchanged (M8-11; §8.6 prohibitions).

## 20. Non-Acceptance Conditions

- **N-01:** Cron (or any timer) still advances a **healthy** job's normal stages (recovery-only
  not achieved).
- **N-02:** A worker failure loses progress — a completed stage re-runs, a stage is skipped, or
  intra-stage batch checkpoint/resume regresses (dedup/coverage guard weakened).
- **N-03:** A checkpoint is eliminated or weakened, or validation is removed/loosened to gain
  speed (§8.6).
- **N-04:** Stages are parallelized on **inferred** dependencies with no declared, verified graph
  (M8-11 gate absent or not green) — or independent stages are **merged** to cut calls (§8.6).
- **N-05:** Regulatory reasoning or any stage's inputs/outputs change without an approved
  Execution Specification change (CW-ARCH-001 §9.9); or the M7A resilience contracts are redefined
  rather than consumed.
- **N-06:** Throughput or reliability is **worse** than the Milestone 6 baseline, or the <5-min /
  median / P95 metrics are not measured and documented.
- **N-07:** The scheduler is changed by hand in production again instead of via a committed
  migration (the §6.6 drift is repeated, not reconciled).
- **N-08 (governance):** Implementation began before this DR was approved (§4A), or the M7
  verification tooling was forked/weakened rather than used.

## 21. Key Risks

- **R-01 Orphaned-job latency under recovery-only (highest for the transition).** Making cron
  recovery-only means a crashed continuous worker relies on the recovery sweep; if that sweep is
  too slow or misfires, a job stalls **longer** than in today's every-tick model. *Mitigation:*
  keep a bounded recovery cadence, reuse `stallReclaim` + the 380s guard, and prefer self-reinvoke
  hand-off (§9.2) so healthy jobs never depend on recovery; A-02/CP-8.4 prove detection+resume
  within a window.
- **R-02 Edge-function wall-clock limit.** A continuous worker cannot run 15 AI stages in one
  invocation. *Mitigation:* soft-time-budget + hand-off with inherited resume (§9.2); no single
  invocation needs to finish the job.
- **R-03 Parallelizing on an undeclared graph (highest for correctness).** Dependencies are
  inferred-only today (§6.4); a wrong assumption corrupts output silently. *Mitigation:* M8-11 —
  declare + verify the graph **before** any parallelism (build step 2 gates step 5); N-04 blocks
  acceptance if crossed.
- **R-04 Provider rate-limit/outage amplification under parallelism.** Concurrent model calls
  raise 429/5xx. *Mitigation:* concurrency cap; unchanged M7A 429/backoff classification; breaker
  consult path wired (enablement evidence-gated, D8-4).
- **R-05 Double-execution race (worker + recovery).** Both could claim the same job.
  *Mitigation:* preserve `FOR UPDATE SKIP LOCKED` + the 380s in-flight guard verbatim (§6.2);
  recovery only launches a worker for jobs not currently mid-flight.
- **R-06 Repo/prod scheduler drift (already present).** Live cron is 30s; the committed migration
  is 1 min (§6.6). *Mitigation:* reconcile via a committed migration as part of M8; N-07 forbids
  repeating the hand-edit.
- **R-07 Resumability regression is the whole risk of speed work.** *Mitigation:* the §11
  preservation contract + the CP-8.3/CP-8.5 fault-injection tests are acceptance-blocking.
- **R-08 Two worker concepts.** Leaving `irr-job-worker` dormant alongside the new worker invites
  drift. *Mitigation:* retire it (D8-6).

## 22. Open Decisions (must be settled before the affected build step)

- **D8-1 — Hand-off mechanism at the time budget.** Self-reinvoke (lowest latency) vs
  return-and-rely-on-recovery-cron (simpler). *Recommend self-reinvoke with recovery fallback.*
  *Before build step 3.*
- **D8-2 — First-touch for freshly queued jobs.** `generate-irr` fire-and-forget kick vs
  recovery-cron pickup. *Recommend kick + recovery fallback.* *Before build step 4.*
- **D8-3 — Recovery cron cadence.** e.g. 1 min vs 2–5 min. *Before build step 4.*
- **D8-4 — Parallel concurrency cap + breaker enablement.** Cap value; and whether parallel load
  justifies enabling the M7A breaker (which would add the deferred `m7a_circuit_state` store) or
  keep it consult-only/off. *Recommend consult-only/off unless step-1 baseline shows correlated
  provider outages.* *Before build step 5.*
- **D8-5 — Measurement store shape.** Additive columns vs a dedicated `m8_execution_metrics`
  table. *Before build step 1.*
- **D8-6 — `irr-job-worker` retirement.** Retire as part of M8 (recommended) vs leave dormant.
  *Before rollout.*

## 23. What this milestone deliberately does NOT change

The IRR field contract; what any stage reasons or emits; the 15-stage identities and sequence
semantics; the checkpoint/resume and batch-replay mechanism (§11); the stalled-job reclamation
primitives; the M7A resilience contracts (taxonomy, retry policy, breaker interface — consumed,
not redefined); and the M7 verification toolchain (used, not extended). M8 changes **when and
where** stages run — worker-owned continuous execution, cron demoted to recovery, independent
stages parallelized on a declared graph — and **how execution latency, throughput, and recovery
are measured**. It does not change **what** the pipeline produces.

---

**This Design Review is DRAFT and authorizes no implementation.** Per CW-GOV-001 §4A, work begins
only after the Milestone Owner approves it. The author does not self-approve; open decisions
§22 (at least D8-1/D8-5 before build step 1–3) should be settled at or before approval.
