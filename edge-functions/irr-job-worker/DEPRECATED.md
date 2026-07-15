# irr-job-worker — dormant / superseded (Milestone 7A, CW-MDR-007A step 4)

**Decision: ALIGNED, not retired (2026-07-15).** Recommend operational retirement as a
follow-up (see below).

## Status: dormant

Evidence gathered during M7A build step 4 (D-1 / §6.7 of CW-MDR-007A):

- **No cron schedule.** `cron.job` runs `irr-stage-engine-tick` (every 30s) and
  `runtime-worker-tick` (every minute). There is **no** entry invoking `irr-job-worker`.
- **Not invoked by `generate-irr`.** That function only queues a job row; the live path is
  the engine's cron claiming via `claim_next_active_irr_job`. `irr-job-worker` (which claims
  via `claim_next_irr_job`) is referenced only in comments, not called.
- **Superseded by `irr-stage-engine`**, which descends from it ("Contract builder unchanged
  from irr-job-worker"). The engine is the production-authoritative path (D-1).

## Why aligned rather than retired

The classifier contradiction the milestone exists to fix (CW-MDR-007A §6.2:
`invalid_response_schema` retryable here but terminal in the engine) was resolved **explicitly**
by routing this path's failure decision through the same central evaluator
(`resilience/decide-failure.ts`) the engine uses — so the two paths can no longer disagree, and
`invalid_response_schema` is now terminal here too. This also demonstrates the M7A-03
centralization across **both** consumers. Gutting/deleting the function is deploy-sensitive and
was out of scope under commit-only; aligning removed the contradiction immediately and safely on
a dormant path.

## Recommended follow-up (operational, not commit-only)

Formally retire `irr-job-worker` — confirm no remaining invoker, then remove the deployed
function (and optionally delete `index.ts` / `pipeline.ts` / `job-store.ts` from the repo). This
is a deploy-time decision for the Milestone Owner, not part of the M7A commit-only build.
