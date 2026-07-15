import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { runIrrPipeline } from './pipeline.ts';
import { claimNextJob, updateJob, setDeadline, reclaimOverdueJobs, requeueJobForRetry, recordRetryEvent } from './job-store.ts';
import { decideFailure } from './resilience/decide-failure.ts';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const WORKER_DEADLINE_MS = 390_000; // 10s under Supabase's 400s worker ceiling

// M7A-03: the pipeline names two failures by position (runtime_timed_out / runtime_failed); map
// those to canonical taxonomy reasons before central classification. All other pipeline stage
// names are already canonical reasons and pass through unchanged. This replaces the old hardcoded
// RETRYABLE_STAGES set — retryability is now decided by the central evaluator (decideFailure),
// the SAME authority irr-stage-engine uses, so the two paths can no longer disagree (fixes the
// CW-MDR-007A §6.2 conflict: invalid_response_schema is now terminal here, matching the engine).
const STAGE_TO_REASON: Record<string, string> = {
  runtime_timed_out: 'generation_timeout',
  runtime_failed: 'network_error',
};

async function processJob(jobId: string, inputPayload: unknown, attemptCount: number, maxAttempts: number) {
  try {
    const result = await runIrrPipeline(inputPayload as any, fetch);
    if (result.status === 'completed') {
      await updateJob(jobId, { status: 'completed', terminal_state: 'PASS', result_json: result, deadline_at: null });
      return;
    }

    const stage = (result as any).stage;
    const reason = STAGE_TO_REASON[stage] ?? stage;
    // Central classification (M7A-03). The worker keeps its EXISTING attempt ceiling for the
    // retry COUNT (per-category ceilings / delay-honoring not adopted here — D-2(a)). The pipeline
    // collapses provider errors into runtime_failed and discards HTTP status, so 429/auth are not
    // subclassified on this (dormant) path — see the retirement note in the step-4 commit.
    const decision = decideFailure(reason, attemptCount + 1, maxAttempts);
    const canRetry = decision.action === 'retry';

    // M7A-12 telemetry: record the failure decision (append-only; measurable attempts + delays).
    await recordRetryEvent({ job_id: jobId, stage, attempt: attemptCount + 1, reason: decision.reason_normalized, category: decision.category, action: decision.action, delay_ms: decision.delay_ms });

    if (canRetry) {
      await requeueJobForRetry(jobId, attemptCount, { stage, reason: decision.reason_normalized, category: decision.category, issues: (result as any).issues ?? null });
      return;
    }

    await updateJob(jobId, {
      status: 'failed',
      terminal_state: (result as any).terminalState ?? null,
      error_json: { ...result, classified_failure: decision.reason_normalized, category: decision.category, exhaustedRetries: decision.exhausted ? attemptCount + 1 : undefined },
      deadline_at: null,
    });
  } catch (err) {
    await updateJob(jobId, { status: 'failed', error_json: { stage: 'worker_uncaught_error', message: (err as Error).message }, deadline_at: null });
  }
}

serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let reclaimed = 0;
  try {
    reclaimed = await reclaimOverdueJobs();
  } catch (err) {
    console.error(`reclaimOverdueJobs failed: ${(err as Error).message}`);
  }

  let job;
  try {
    job = await claimNextJob();
  } catch (err) {
    return jsonResponse({ status: 'error', stage: 'claim_failed', message: (err as Error).message, reclaimed }, 500);
  }

  if (!job) {
    return jsonResponse({ status: 'idle', message: 'No queued jobs.', reclaimed }, 200);
  }

  try {
    await setDeadline(job.job_id, WORKER_DEADLINE_MS);
  } catch (err) {
    await updateJob(job.job_id, { status: 'failed', error_json: { stage: 'deadline_write_failed', message: (err as Error).message } });
    return jsonResponse({ status: 'processed', job_id: job.job_id, outcome: 'deadline_write_failed', reclaimed }, 200);
  }

  // @ts-ignore -- EdgeRuntime is a Supabase/Deno Deploy global, not in std types.
  EdgeRuntime.waitUntil(processJob(job.job_id, job.input_payload, job.attempt_count ?? 0, job.max_attempts ?? 2));

  return jsonResponse({ status: 'processing', job_id: job.job_id, attempt: (job.attempt_count ?? 0) + 1, reclaimed }, 202);
});
