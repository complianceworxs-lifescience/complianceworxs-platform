# CW-MDR-008 — Milestone 8 Baseline Measurement (Build Step 1 / CP-8.1)

**Status:** Baseline evidence (build step 1 of CW-MDR-008 §14; gate CP-8.1). No execution change.
**Milestone:** 8 — Execution Engine Optimization (CW-GOV-001 §8)
**Design Review:** CW-MDR-008 v1.0 (APPROVED 2026-07-17, §4A gate passed)
**Author:** Claude Code (implementer)
**Date measured:** 2026-07-17
**Method (D8-5):** derived **by read-only query from existing `irr_jobs` / `irr_stage_runs`
columns** (per-stage `started_at`/`completed_at`/`duration_ms`, `status`, `attempt`). No schema
change, no new table, no execution change — exactly the D8-5 resolution.

---

## 1. Purpose

Record the **"before"** the §8.5 success metrics compare against, from real production data, so the
post-change measurement (build step 6 / CP-8.6) has a truthful baseline. This is measurement only;
it changes nothing in the execution engine.

## 2. Corpus and caveats (stated, not smoothed)

- Source project: production `balkvbmtummehgbbeqap`, all data through **2026-07-16**; 10 active
  days; **bursty** (batch test runs, not steady traffic).
- Of 50 rows with `irr_jobs.status='completed'`, only **24** carry a full set of `irr_stage_runs`
  (≥15 completed stages). The other ~26 have no stage rows (legacy/seed/old-worker completions) and
  are **excluded** from latency stats. One sentinel job with `created_at = 2000-01-01` is excluded.
- Observed end-to-end spans include two real-world inflators that a controlled post-change run will
  not have: **round-robin contention** (batch runs queue many jobs; one job advances per cron tick,
  so each job waits several ticks per stage) and **cross-session idle** (a job left overnight
  between test sessions). The P50 is reported as representative; the max (~23 h) is such an outlier.
- Baseline is therefore anchored on two robust, contention-independent quantities — **actual work
  time** (Σ stage `duration_ms`) and the **median inter-stage gap** — alongside the observed spans.

## 3. Latency baseline (24 full-pipeline completed jobs)

| Metric | P50 | P95 | Notes |
|--------|----:|----:|-------|
| **End-to-end pipeline span** (first stage start → last stage complete) | **2206.6 s ≈ 36.8 min** | 5829.7 s ≈ 97.2 min | includes contention + cross-session idle |
| **Actual work** (Σ stage `duration_ms`) | **459.4 s ≈ 7.7 min** | 624.0 s ≈ 10.4 min | real AI/compute time; contention-independent |
| **Idle / poll-gap** (span − work, at P50) | **1747.2 s ≈ 29.1 min** | — | ≈ **79%** of end-to-end is waiting, not working |
| **Inter-stage gap** (per boundary, 360 boundaries) | **30.0 s** | 509 s ≈ 8.5 min | P50 == the cron tick |

## 4. The headline finding

**A typical complete IRR takes ≈ 36.8 min end-to-end, of which only ≈ 7.7 min is actual work and
≈ 29 min (≈ 79%) is idle poll-gap waiting.** The median inter-stage gap is **exactly 30.0 s** — the
cron tick — because stage N's completion does not trigger stage N+1; the next tick does (CW-MDR-008
§6.1). Under batch contention the per-stage gap stretches well beyond one tick (P95 ≈ 8.5 min).

**Two consequences for the §8.5 target (typical < 5 min):**

1. **Removing the poll gap is necessary but not sufficient.** Worker-owned continuous execution
   (M8-02) collapses idle toward zero, taking a typical job from ≈ 37 min to roughly its **work
   time ≈ 7.7 min**. That is a ~5× win — but still **above** the 5-minute target.
2. **Parallelizing the independent band is required, not optional.** Sequential work alone (P50
   ≈ 7.7 min) exceeds 5 min, so meeting the metric depends on parallel execution of the independent
   stages 7–11 (M8-06) to shorten the work critical path. This confirms parallelization belongs in
   M8 scope and must clear its declared-graph gate (M8-11) — it is on the critical path to the
   metric, not a nice-to-have.

## 5. Corroboration of the §6.6 scheduler-drift finding

The measured median inter-stage gap is **30.0 s**, matching the **live** cron (`cron.job` jobid 138
= `30 seconds`) and **not** the committed migration (`* * * * *` = 1 min). The execution data
independently confirms the repo/prod drift flagged in CW-MDR-008 §6.6 — the deployed tick is 30 s.

## 6. Reliability / recovery baseline

- **Completion rate:** 50 completed vs 46 failed = **52.1%** of terminal outcomes completed.
  **⚠️ Not clean reliability data — do NOT cite this as "current production reliability."** The 46
  failures mix real runs with historical test/development failures on a bursty 10-day window; the
  figure is a conservative *floor* only. A clean reliability comparison must come from the
  controlled, like-for-like post-change run (CP-8.6), not from this mixed history.
- **Terminal stage failures:** 5 `irr_stage_runs` rows in `status='failed'`.
- **Re-attempts:** every full-pipeline job had at least one stage with `attempt > 1` (a re-claim /
  retry / stall-reclaim). `attempt` increments per claim, so this is expected texture of the
  poll-and-reclaim model, not necessarily error retries.
- **Recovery-time:** not cleanly derivable from historical data (no per-event recovery timestamps).
  The current recovery bound is the **10-minute stall-reclaim threshold** in code
  (`irr-stage-engine/index.ts:795-801`). Event-level recovery latency will be measured once the
  recovery-only mechanism lands (build step 4) and compared at CP-8.6.
- **Throughput:** not cleanly derivable from bursty historical data; it will be measured under a
  controlled comparable load in the post-change step and compared to this baseline (§8.5 throughput
  ≥ Milestone 6 baseline).

## 7. Reproducibility (exact queries)

All figures are read-only and reproducible against `irr_jobs` / `irr_stage_runs`:

- **Full-pipeline span + work decomposition** — completed jobs with ≥15 completed stages;
  `span_s = last(completed_at) − first(started_at)`, `work_ms = Σ duration_ms`; percentile_cont
  P50/P95; `idle_p50 = span_p50 − work_p50`.
- **Inter-stage gap** — `lead(started_at) OVER (PARTITION BY job_id ORDER BY stage) − completed_at`
  over completed stage rows; percentile_cont P50/P95.
- **Reliability** — counts of `irr_jobs.status` and `irr_stage_runs.status`/`attempt`.

(The queries exclude the `created_at = 2000-01-01` sentinel and jobs without stage rows, per §2.)

## 8. Gate status (CP-8.1)

**PASS for the measurable metrics.** A real P50/P95 latency baseline with a work/idle decomposition
and a reliability floor now exists, before any execution change. Throughput and per-event recovery
latency are explicitly deferred to controlled measurement at CP-8.6 (they are not derivable from
bursty historical data) — flagged here rather than fabricated.

**Next (build step 2):** the declared, verified stage dependency graph (M8-11) — the prerequisite
gate before any parallel-execution work, which §4 shows is required to reach the < 5-minute target.
