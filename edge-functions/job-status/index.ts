import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const jobId = url.searchParams.get('job_id');
  if (!jobId) {
    return jsonResponse({ error: 'job_id query parameter is required, e.g. ?job_id=...' }, 400);
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/irr_jobs?job_id=eq.${jobId}&select=*`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });

  if (!res.ok) {
    const text = await res.text();
    return jsonResponse({ error: `Failed to look up job: ${text.slice(0, 500)}` }, 502);
  }

  const rows = await res.json();
  const job = Array.isArray(rows) ? rows[0] : null;

  if (!job) {
    return jsonResponse({ error: 'Job not found' }, 404);
  }

  return jsonResponse(job, 200);
});
