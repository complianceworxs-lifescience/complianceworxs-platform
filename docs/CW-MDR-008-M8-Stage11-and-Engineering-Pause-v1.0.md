# CW-MDR-008 — Milestone 8: Stage 11 Finding & Engineering Pause

**Status:** Engineering **PAUSED** by the CEO / Milestone Owner (2026-07-20), pending business
validation. Milestone 8 remains **Open** (not closed). This document captures the Stage 11 finding
as parked, resumable engineering debt and records the decision to stop optimizing runtime until the
market confirms runtime is the revenue blocker.
**Milestone:** 8 — Execution Engine Optimization (CW-GOV-001 §8)
**Author:** Claude Code (implementer). Records the Owner's decision; the author does not self-decide.
**Date:** 2026-07-20

---

## 1. Why this document exists

Milestone 8 reached an inflection point: the orchestration redesign works and the system has
demonstrated the customer-facing hard requirements (completes, no data loss, no manual
intervention, correct output). The one remaining engineering issue is **latency**, localized to a
single stage. The Owner's decision is to **not authorize further runtime optimization** until it is
validated with real customers that latency — not correctness — is what stands between the product
and revenue. This document preserves the Stage 11 finding so that work can resume immediately and
without rediscovery **if** that validation says latency matters.

## 2. What was accomplished (engineering)

- Corrected the milestone framing: M8 is a **latency** milestone, and the root bottleneck is
  **orchestration**, not scheduling.
- Implemented and deployed the **look-ahead hand-off** (`11cd7b7` → engine **v35**, byte-verified,
  ezbr `9d661ebe…`): the worker runs **at most one AI stage per invocation**, so each long stage
  starts with a full, fresh platform budget. Fast code stages still chain (no cron gap).
- Result: cross-stage mid-stage kills were **eliminated for stages 1–10** (both validation runs ran
  those stages clean, all attempt 1) — where the pre-fix v34 engine had kills on stages 5, 8, and 10.

## 3. Validation evidence (identical real input: "Lot 24P3487" dissolution-release IRR)

| Metric | Run 1 (`5d6ea959`) | Run 2 (`08062dda`) |
|--------|-------------------:|-------------------:|
| Stages completed | 15 / 15 | 15 / 15 |
| Stages 1–10 | all attempt 1, clean | all attempt 1, clean |
| **Stage 11 attempts** | 2 | 3 |
| Stage 11 successful wall time | 131 s | 25 s |
| **Platform terminations (all on stage 11)** | 1 | 2 |
| Recovery delay (in-flight guard) | ~408 s | ~799 s |
| **End-to-end latency** | 14.67 min | 19.50 min |
| Clean sequential floor (excl. stage-11 recovery) | ~7.9 min | ~6.2 min |
| Data loss | none | none |
| Manual intervention | none | none |

**Historical control (old engine, 8 prior runs of the same input, 2026-07-19):** Stage 11 required
**2–4 attempts**. So multi-attempt Stage 11 is a **pre-existing characteristic of the stage on this
input, not a regression** introduced by v35.

## 4. Stage 11 finding (the documented engineering debt)

**Classification (per the Owner's decision rule): "always ≥ 2 attempts → the stage architecture
requires intra-stage checkpointing/hand-off."** Runs 1–2 (2, 3) and history (2–4) show Stage 11
(`remediation_scaffold`, the heaviest batched reasoning stage) **consistently** needs multiple
invocations — this is consistent behavior, not tail variance.

**Mechanism:** the successful attempts are fast (25–131 s), so the stage fits an invocation easily.
The cost comes from its **early attempts being hard-killed** by the platform mid-stage — the row is
left `running` with no clean failure logged (no retry event) — after which recovery waits out the
**~380 s in-flight guard** before re-claiming. The stage's internal self-checkpoint is not firing
*before* the platform kill, so instead of a fast, clean hand-off between batches, each kill costs
~380–400 s of dead time. Per-batch checkpointing still preserves all work (zero data loss), but the
recovery latency inflates end-to-end time.

**Proposed fix (DESIGN ONLY — NOT built):** intra-stage hardening of the batched loop (stages 7–11,
Stage 11 first) — have the batch loop **voluntarily checkpoint-and-exit well under the platform
limit** (lower the internal ceiling / add a per-invocation batch budget with a clean hand-off),
so a heavy batched stage advances across invocations by fast, deliberate hand-offs (seconds)
instead of hard-kill + ~380 s guard recovery. Expected effect: pull median toward the ~7-min clean
floor and P95 under the latency gate. This is **optimization, not correctness** — the system already
completes correctly without it.

## 5. Executive validation dashboard (snapshot at pause)

| KPI | Value |
|-----|-------|
| Validation runs (real input) | 2 |
| **Success rate** | **100%** (2 / 2 completed) |
| Median completion | 17.1 min (clean floor ≈ 7 min) |
| P95 completion | ~19.5 min (n = 2) |
| Recoveries per run | 1.5 |
| Manual interventions | 0 |
| Data loss | 0 |
| **Production readiness (latency gate)** | Not met — driven entirely by Stage 11 recovery |
| **Production readiness (correctness/reliability)** | Met for this input |

## 6. Decision (Owner, 2026-07-20)

**"Production Ready" is redefined to what the market requires, deliberately excluding a latency
target:** completes reliably · output quality acceptable · no manual intervention · no data loss ·
**customers willing to pay.** A 5-minute (or 8-minute) latency target is an engineering goal, not a
confirmed market requirement — QA Directors authorizing a CAPA or batch release routinely wait far
longer for defensible records.

**Engineering is paused.** No further runtime optimization (Stage 11 hardening, parallel bands,
recovery-cron cadence) is authorized until one question is answered by **real customer validation**,
not engineering tests:

> **Is Stage 11 latency preventing us from selling the product?**

Customer-validation questions to answer first (e.g. with Wells Pharma or another trusted customer on
the current system): (1) Is the output useful? (2) Would you use this in production? (3) Is 15–20 min
acceptable? (4) What would stop you paying $497?

- **If "yes, latency blocks revenue"** → resume with Stage 11 intra-stage hardening (§4).
- **If "no"** → stop optimizing; the parked debt below stays parked.

## 7. Parked engineering debt (resumable; do not action without authorization)

1. **Stage 11 (batched-loop) intra-stage hardening** — §4. First candidate if latency is a blocker.
2. **Parallel execution bands** ({7,10,11} → {8,9}, build step 5) — the only path to <5 min if that
   ever becomes the target; gated on the verified dependency graph (M8-11, already built).
3. **Recovery-cron migration** (30 s → 1 min recovery-only, `20260717000001…`) — committed, **HELD**,
   not applied.
4. **Model-output robustness on the reasoning stages** — the two *synthetic* inputs failed on
   `model_output` (`refusal` / `invalid_json`) on the batched stages. For **"any supported GMP
   decision"** (not just Lot 24P3487), this — not Stage 11 or parallelization — is the top reliability
   risk to the first real-customer milestone. Separate workstream from orchestration/latency.

## 8. Production state at pause (nothing left dangling)

- Engine **v35** (look-ahead) live and byte-verified; all code committed and pushed.
- Cron still **30 s** (recovery-only migration HELD, not applied); it remains the live recovery net.
- **Rollback baseline v32 / v11 intact** — revert if customer traffic resumes and v35 shows a
  regression outside the known Stage 11 / model-output behavior.
- Queue idle; both validation jobs completed; zero manual intervention outstanding.

## 9. The milestone that actually matters next

Not "median latency ≤ 8 minutes." It is:

> **A paying customer uses the new IRR in a real compliance decision and says, "This is now part of
> our process."**

That is the milestone that moves the business from software project to business. The engineering
debt in §7 is paid down *after* the market confirms the product is solving the right problem.
