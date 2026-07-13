import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { runOrchestrator } from './orchestrator.ts';

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

function isValidRequestShape(body: any): body is { assetType: string; topic: string; audience: string; commercialObjective: string; sourceMaterial: string } {
  return body && typeof body === 'object'
    && typeof body.assetType === 'string'
    && typeof body.topic === 'string' && body.topic.trim().length > 0
    && typeof body.audience === 'string' && body.audience.trim().length > 0
    && typeof body.commercialObjective === 'string' && body.commercialObjective.trim().length > 0
    && typeof body.sourceMaterial === 'string' && body.sourceMaterial.trim().length > 0;
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

  if (!isValidRequestShape(body)) {
    return jsonResponse({ status: 'failed', stage: 'request_invalid', issues: [{ message: 'assetType, topic, audience, commercialObjective, and sourceMaterial are all required non-empty strings.' }], executionHistory: [] }, 400);
  }

  const result = await runOrchestrator(body, urls, fetch);
  return jsonResponse(result, result.status === 'completed' ? 200 : 422);
});
