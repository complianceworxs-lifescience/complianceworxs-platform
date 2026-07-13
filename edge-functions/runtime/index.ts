import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { executePromptPackage } from './runtime.ts';
import { claudeAdapter } from './claude-adapter.ts';
import { openaiAdapter } from './openai-adapter.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer, accept, accept-profile, content-profile',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const adapters = { claude: claudeAdapter, gpt: openaiAdapter };

// Was 800 -- far too low for a multi-section structured artifact (an IRR alone has
// ~20 required output fields, several of them _list arrays with substantial content).
// The model was getting cut off mid-response, producing invalid/incomplete JSON that
// failed schema validation downstream. Raised to a level that comfortably fits the
// largest current contract (IRR); callers needing more can still override explicitly.
const DEFAULT_MAX_TOKENS = 4096;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { promptPackage, userVariables, model, maxTokens } = (body ?? {}) as {
    promptPackage?: any; userVariables?: Record<string, string>; model?: string; maxTokens?: number;
  };

  if (!promptPackage) return jsonResponse({ error: 'promptPackage is required' }, 400);

  const runtime = promptPackage?.promptSpecification?.targetRuntime;
  const apiKey = runtime === 'gpt' ? OPENAI_API_KEY : ANTHROPIC_API_KEY;

  const result = await executePromptPackage(
    promptPackage,
    userVariables ?? {},
    { model: model ?? (runtime === 'gpt' ? 'gpt-5' : 'claude-sonnet-4-5'), maxTokens: maxTokens ?? DEFAULT_MAX_TOKENS, apiKey },
    adapters,
    fetch,
  );

  return jsonResponse(result, result.status === 'executed' ? 200 : 422);
});
