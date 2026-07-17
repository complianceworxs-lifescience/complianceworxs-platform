// CW-MDR-008 M8-02 — continuous-execution loop decision (build step 3).
//
// Pure decision for what the worker loop does after a stage settles. Extracted from index.ts so
// the loop's control flow is deterministically unit-testable in Node (no Deno/edge runtime),
// mirroring the M7A decide-failure.ts extraction. index.ts imports this; the loop stays in
// driveJob(), only the branch decision lives here.
//
// Actions:
//   'complete_job' — the last stage just completed; mark the job done.
//   'advance'      — run the next consecutive stage in the SAME invocation (no cron gap).
//   'handoff'      — soft budget hit; self-reinvoke to continue in a fresh invocation.
//   'retry'        — the stage requested a retry; self-reinvoke (a fresh invocation re-claims it).
//   'stop'         — terminal failure; the job is already marked failed, nothing more to do.
export type PlanAction = 'complete_job' | 'advance' | 'handoff' | 'retry' | 'stop';

export function planNext(
  outcome: 'completed' | 'retry' | 'terminal',
  completedStage: number,
  stageCount: number,
  elapsedMs: number,
  budgetMs: number,
): PlanAction {
  if (outcome === 'terminal') return 'stop';
  if (outcome === 'retry') return 'retry';
  if (completedStage >= stageCount) return 'complete_job';
  return elapsedMs >= budgetMs ? 'handoff' : 'advance';
}
