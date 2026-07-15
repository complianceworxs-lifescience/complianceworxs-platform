const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function headers(): Record<string, string> {
  return { 'Content-Type': 'application/json', apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, Prefer: 'return=representation' };
}

export interface ClaimedJob { job_id: string; input_payload: unknown; status: string; attempt_count: number; max_attempts: number; }

// M7A-12: append-only retry/failure telemetry. Best-effort — never break job processing on a
// telemetry write failure.
export async function recordRetryEvent(ev: { job_id: string; stage: string; attempt: number; reason: string; category: string; action: 'retry' | 'terminal'; delay_ms: number }): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/m7a_retry_events`, { method: 'POST', headers: headers(), body: JSON.stringify({ job_id: ev.job_id, stage_name: ev.stage, attempt: ev.attempt, reason: ev.reason, category: ev.category, action: ev.action, delay_ms: ev.delay_ms, source: 'irr-job-worker' }) });
  } catch (e) {
    console.error('m7a_retry_events insert failed (non-fatal):', (e as Error).message);
  }
}

export async function claimNextJob(): Promise<ClaimedJob | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_next_irr_job`, { method: 'POST', headers: headers(), body: JSON.stringify({}) });
  if (!res.ok) { const text = await res.text(); throw new Error(`claim_next_irr_job failed (status ${res.status}): ${text.slice(0, 500)}`); }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0] as ClaimedJob;
}

export async function updateJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/irr_jobs?job_id=eq.${jobId}`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
  if (!res.ok) { const text = await res.text(); console.error(`Failed to update job ${jobId} (status ${res.status}): ${text.slice(0, 500)}`); }
}

export async function requeueJobForRetry(jobId: string, attemptCount: number, lastError: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/irr_jobs?job_id=eq.${jobId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({
      status: 'queued',
      attempt_count: attemptCount + 1,
      error_json: { ...lastError, retried: true, retry_attempt: attemptCount + 1 },
      deadline_at: null,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) { const text = await res.text(); console.error(`Failed to requeue job ${jobId} (status ${res.status}): ${text.slice(0, 500)}`); }
}

export async function setDeadline(jobId: string, deadlineMs: number): Promise<void> {
  const deadlineAt = new Date(Date.now() + deadlineMs).toISOString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/irr_jobs?job_id=eq.${jobId}`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ deadline_at: deadlineAt, updated_at: new Date().toISOString() }) });
  if (!res.ok) { const text = await res.text(); throw new Error(`Failed to set deadline for job ${jobId} (status ${res.status}): ${text.slice(0, 500)}`); }
}

export async function reclaimOverdueJobs(): Promise<number> {
  const nowIso = new Date().toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/irr_jobs?status=eq.running&deadline_at=lt.${nowIso}`,
    {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({
        status: 'failed',
        error_json: { stage: 'runtime_timed_out', message: 'Job exceeded its worker deadline and was never marked terminal -- the worker was almost certainly recycled or killed mid-generation. Reclaimed deterministically rather than left abandoned.' },
        deadline_at: null,
        updated_at: nowIso,
      }),
    },
  );
  if (!res.ok) { const text = await res.text(); throw new Error(`reclaimOverdueJobs failed (status ${res.status}): ${text.slice(0, 500)}`); }
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}
