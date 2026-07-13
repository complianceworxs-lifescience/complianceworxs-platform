import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { runEditorialAssurance } from './validator.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? null;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer, accept, accept-profile, content-profile',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const STATUS_BY_TERMINAL_STATE: Record<string, number> = {
  PASS: 200,
  REWRITE_REQUIRED: 422,
  REJECT: 422,
  SPECIFICATION_ERROR: 400,
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { artifact, executionSpecification, promptPackage, runtimeManifest, skipEditorialReview } = (body ?? {}) as any;
  if (!artifact || !executionSpecification || !promptPackage || !runtimeManifest) {
    return jsonResponse({ error: 'artifact, executionSpecification, promptPackage, and runtimeManifest are all required' }, 400);
  }

  const report = await runEditorialAssurance(
    artifact,
    executionSpecification,
    promptPackage,
    runtimeManifest,
    skipEditorialReview ? null : ANTHROPIC_API_KEY,
    fetch,
  );

  return jsonResponse(report, STATUS_BY_TERMINAL_STATE[report.terminalState] ?? 500);
});
