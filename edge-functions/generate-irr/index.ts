import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { validateIrrRequest } from './service.ts';
import { createJob } from './job-store.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// M8 build step 4 (D8-2): first-touch kick. With cron demoted to recovery-only, a freshly-queued
// job must not wait for the next recovery sweep -- fire a non-blocking POST to the stage engine so
// the worker-owned loop picks it up immediately. Fire-and-forget: the child invocation is triggered
// on request receipt, so we abort waiting for its (long) response; waitUntil keeps this isolate
// alive just long enough to deliver the request. A dropped kick is harmless -- the recovery cron is
// the fallback that still claims the queued job.
function kickWorker(): void {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  const p = fetch(`${SUPABASE_URL}/functions/v1/irr-stage-engine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: '{}',
    signal: ctrl.signal,
  }).then(() => {}).catch(() => {}).finally(() => clearTimeout(timer));
  // @ts-ignore -- EdgeRuntime is a Supabase/Deno Deploy global, not in std types.
  EdgeRuntime.waitUntil(p);
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer, accept, accept-profile, content-profile',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// IMPORTANT -- this function no longer runs the pipeline itself.
//
// The previous version created the job, then tried to run runIrrPipeline in
// a background promise handed to EdgeRuntime.waitUntil() after already
// sending the 202 response. That pattern did not reliably keep this
// isolate alive: 100% of jobs created that way got stuck at
// status='running' forever, with no error ever recorded, because
// everything after the first status update got abandoned when the isolate
// was torn down.
//
// This function's job now is: validate the request, create the job row as
// status='queued', fire a first-touch kick at the stage engine so it starts
// immediately (M8 build step 4 / D8-2), and return. The live consumer is
// irr-stage-engine (worker-owned continuous execution, CW-MDR-008), NOT the
// dormant irr-job-worker; the recovery cron is only a fallback if the kick is
// dropped. (This corrects the previous comment, which named irr-job-worker.)
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const validation = validateIrrRequest(body);
  if (!validation.valid) {
    return jsonResponse({ status: 'rejected', stage: 'request_invalid', issues: validation.issues }, 400);
  }

  let jobId: string;
  try {
    jobId = await createJob(validation.request);
  } catch (err) {
    return jsonResponse({ status: 'rejected', stage: 'job_creation_failed', issues: [{ field: 'job', message: (err as Error).message }] }, 502);
  }

  // First-touch kick (D8-2): start the worker immediately; harmless if dropped (recovery cron
  // is the fallback). Never blocks or fails the enqueue.
  kickWorker();

  return jsonResponse({ job_id: jobId, status: 'queued' }, 202);
});
