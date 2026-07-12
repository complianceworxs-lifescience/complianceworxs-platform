import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { runIrrPipeline } from './pipeline.ts';
import { claimNextJob, updateJob, setDeadline, reclaimOverdueJobs, requeueJobForRetry } from './job-store.ts';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const WORKER_DEADLINE_MS = 390_000; // 10s under Supabase's 400s worker ceiling

const RETRYABLE_STAGES = new Set(['invalid_json_output', 'invalid_response_schema']);

async function processJob(jobId: string, inputPayload: unknown, attemptCount: number, maxAttempts: number) {
  try {
    const result = await runIrrPipeline(inputPayload as any, fetch);
    if (result.status === 'completed') {
      await updateJob(jobId, { status: 'completed', terminal_state: 'PASS', result_json: result, deadline_at: null });
      return;
    }

    const stage = (result as any).stage;
    const isRetryable = RETRYABLE_STAGES.has(stage);
    const canRetry = isRetryable && attemptCount + 1 < maxAttempts;

    if (canRetry) {
      await requeueJobForRetry(jobId, attemptCount, { stage, issues: (result as any).issues ?? null });
      return;
    }

    await updateJob(jobId, {
      status: 'failed',
      terminal_state: (result as any).terminalState ?? null,
      error_json: { ...result, exhaustedRetries: isRetryable ? attemptCount + 1 : undefined },
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