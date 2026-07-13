import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { validateIrrRequest } from './service.ts';
import { createJob } from './job-store.ts';

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
// This function's only job now is: validate the request, create the job
// row as status='queued', and return immediately. The irr-job-worker
// function (triggered every minute by pg_cron) claims queued jobs one at a
// time via claim_next_irr_job() and runs the actual pipeline synchronously
// within its own request/response cycle, which gives it a concrete reason
// to stay alive until the work finishes.
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

  return jsonResponse({ job_id: jobId, status: 'queued' }, 202);
});
