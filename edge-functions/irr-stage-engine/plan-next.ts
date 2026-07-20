// CW-MDR-008 M8-02 — continuous-execution loop decision, with look-ahead hand-off (build step 3
// + the build-step-3 validation fix).
//
// Pure decision for what the worker loop does after a stage settles. Extracted from index.ts so
// the loop's control flow is deterministically unit-testable in Node (no Deno/edge runtime),
// mirroring the M7A decide-failure.ts extraction. index.ts imports this; the loop stays in
// driveJob(), only the branch decision lives here.
//
// LOOK-AHEAD HAND-OFF: the earlier version handed off blindly on elapsed time, which let the loop
// start a long AI stage with little budget left -> the platform killed the invocation mid-stage ->
// a ~380s recovery cycle repeated (observed live in build-step-3 validation). The fix is
// orchestration, not a smaller number: run at most ONE AI stage per invocation. AI stages (esp.
// the batched 7-11, which self-checkpoint up to ~380s internally) need a full fresh platform
// budget; chaining a second one risks the mid-stage kill. So if the NEXT stage is an AI stage and
// this invocation has already run one, hand off (the completed stage is persisted; the next AI
// stage starts fresh). Fast code stages chain freely. This mirrors the proven old model's
// one-stage-per-invocation isolation for AI stages, while still chaining code stages with no cron gap.
//
// Actions:
//   'complete_job' — the last stage just completed; mark the job done.
//   'advance'      — run the next consecutive stage in the SAME invocation.
//   'handoff'      — self-reinvoke so the next (AI) stage runs in a fresh invocation with full budget.
//   'retry'        — the stage requested a retry; self-reinvoke (a fresh invocation re-claims it).
//   'stop'         — terminal failure; the job is already marked failed, nothing more to do.
export type PlanAction = 'complete_job' | 'advance' | 'handoff' | 'retry' | 'stop';

export function planNext(
  outcome: 'completed' | 'retry' | 'terminal',
  completedStage: number,
  stageCount: number,
  nextStageIsAi: boolean,
  aiAlreadyRanThisInvocation: boolean,
): PlanAction {
  if (outcome === 'terminal') return 'stop';
  if (outcome === 'retry') return 'retry';
  if (completedStage >= stageCount) return 'complete_job';
  // Look-ahead: don't start a second AI stage in an invocation that already ran one.
  if (nextStageIsAi && aiAlreadyRanThisInvocation) return 'handoff';
  return 'advance';
}
