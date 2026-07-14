import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { validateEditorialContract } from './validator.ts';

// MILESTONE 1 SCOPE: this function calls the validator only.
// It does not call Anthropic, does not write to Supabase, and does
// not generate an Execution Specification or Prompt Specification.
// Per governance instruction: "Prompt Specifications and AI Services
// are prohibited in Milestone 1."

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer, accept, accept-profile, content-profile',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

  const result = validateEditorialContract(body);
  return jsonResponse(result, result.status === 'valid' ? 200 : 422);
});
