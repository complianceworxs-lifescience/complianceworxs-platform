import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { validateExecutiveBriefRequest } from './service.ts';
import { runExecutiveBriefPipeline } from './pipeline.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

const urls = {
  validateContract: `${SUPABASE_URL}/functions/v1/validate-editorial-contract`,
  compileContract: `${SUPABASE_URL}/functions/v1/compile-editorial-contract`,
  compilePrompt: `${SUPABASE_URL}/functions/v1/compile-prompt-specification`,
  runtime: `${SUPABASE_URL}/functions/v1/runtime`,
  validateOutput: `${SUPABASE_URL}/functions/v1/validate-editorial-output`,
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer, accept, accept-profile, content-profile',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const validation = validateExecutiveBriefRequest(body);
  if (!validation.valid) {
    return jsonResponse({ status: 'rejected', stage: 'request_invalid', issues: validation.issues }, 400);
  }

  const result = await runExecutiveBriefPipeline(validation.request, urls, fetch);
  return jsonResponse(result, result.status === 'completed' ? 200 : 422);
});
