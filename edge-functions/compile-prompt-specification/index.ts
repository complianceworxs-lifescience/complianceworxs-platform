import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { compilePromptSpecification } from './prompt-compiler.ts';

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

  const { executionSpecification, targetRuntime } = (body ?? {}) as { executionSpecification?: unknown; targetRuntime?: unknown };
  const result = compilePromptSpecification(executionSpecification, targetRuntime);
  return jsonResponse(result, result.status === 'compiled' ? 200 : 422);
});