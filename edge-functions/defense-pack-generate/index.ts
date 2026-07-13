import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

// Updated CORS → defend.complianceworxs.com
const ALLOWED_ORIGINS = [
  'https://defend.complianceworxs.com',
  'https://cases.complianceworxs.com', // keep during transition
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

const SYSTEM_PROMPT = `You are an FDA compliance expert specializing in batch release authorization records for life sciences companies regulated under 21 CFR Part 211.

A compliance professional has uploaded their batch release documentation. Your job is to produce a complete, inspection-ready Batch Release Authorization Record in structured JSON format.

CRITICAL RULES:
- NEVER fabricate facts, data, lot numbers, test results, names, or dates not present in the source documents
- NEVER invent conditions, thresholds, or outcomes not supported by the evidence
- DO extract all facts directly present in the uploaded documents
- DO construct the decision logic layer — traceability, rationale, thresholds, counterfactuals — derived from the facts
- DO flag missing elements clearly in the missing_elements array
- If a field cannot be determined from the documents, use "[Not specified in source documents]" as the value

Source documents = evidence. Your output = the decision logic built from that evidence.

Return ONLY valid JSON matching this exact schema. No markdown, no preamble, no explanation. Raw JSON only.

{
  "document_id": "CW-BR-[YEAR]-[4-digit-sequence]",
  "inspector_question": "Who authorized the release of this batch, based on what evidence, and why was that decision justified?",
  "lot_number": "string — extracted from documents",
  "product_name": "string — extracted from documents",
  "batch_size": "string — extracted from documents or [Not specified]",
  "decision_owner": "string — name of person who authorized release, extracted from documents",
  "decision_owner_role": "string — their title and authority designation",
  "authorization_timestamp": "string — date and time of authorization if present",
  "evidence": [
    { "document": "Document type/name", "reference": "Reference ID or number" }
  ],
  "traceability": [
    {
      "evidence": "Reference ID of this piece of evidence",
      "finding": "What this document shows — be specific to actual data",
      "impact": "What that finding means for the authorization decision"
    }
  ],
  "risk_evaluations": [
    {
      "area": "Risk category",
      "condition": "What was observed — from the documents",
      "threshold": "The acceptance rule that applies — derived from regulatory context",
      "result": "Acceptable or Not Acceptable"
    }
  ],
  "rationale_points": [
    "Each point states what the evidence shows AND what conclusion follows."
  ],
  "rationale_conclusion": "The formal conclusion statement.",
  "counterfactual_conditions": [
    "Specific condition that would have prevented release"
  ],
  "authorization_statement": "Formal first-person authorization statement. Must cite 21 CFR 211.22 and 211.192. Must reference the specific lot and product.",
  "self_check": [
    { "item": "Criterion description", "pass": true, "location": "Section X" }
  ],
  "missing_elements": [
    "Description of any element required for a complete authorization record that was absent from the uploaded documentation"
  ]
}`;

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const token = authHeader.split(' ')[1];
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { data: tokenData, error: tokenError } = await supabase.from('user_tokens').select('tokens_remaining, tokens_used').eq('user_id', user.id).single();
  if (tokenError || !tokenData || tokenData.tokens_remaining < 1) {
    return new Response(JSON.stringify({ error: 'No tokens remaining', code: 'NO_TOKENS' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const body = await req.json();
  const { documentContent, scenario } = body;
  if (!documentContent || documentContent.trim().length < 10) {
    return new Response(JSON.stringify({ error: 'No document content provided' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { error: updateError } = await supabase.from('user_tokens').update({ tokens_remaining: tokenData.tokens_remaining - 1, tokens_used: tokenData.tokens_used + 1 }).eq('user_id', user.id);
  if (updateError) {
    return new Response(JSON.stringify({ error: 'Token consumption failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  await supabase.from('generation_log').insert({
    user_id: user.id, email: user.email, scenario: scenario || 'batch-release',
    tokens_before: tokenData.tokens_remaining, tokens_after: tokenData.tokens_remaining - 1,
    ip_address: req.headers.get('x-forwarded-for') || 'unknown',
    user_agent: req.headers.get('user-agent') || 'unknown',
  });

  const userPrompt = `Analyze the following batch release documentation and produce the authorization record JSON.

Extract all facts directly from these documents. Construct the decision logic layer from those facts.
Do not fabricate anything not present in the source. Flag missing elements clearly.

Source documents:
${documentContent}`;

  const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userPrompt }] }),
  });

  if (!anthropicResponse.ok) {
    await supabase.from('user_tokens').update({ tokens_remaining: tokenData.tokens_remaining, tokens_used: tokenData.tokens_used }).eq('user_id', user.id);
    return new Response(JSON.stringify({ error: 'Generation failed — token refunded' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const anthropicData = await anthropicResponse.json();
  const rawText = anthropicData.content?.[0]?.text || '';

  let recordData;
  try {
    const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    recordData = JSON.parse(cleaned);
  } catch {
    await supabase.from('user_tokens').update({ tokens_remaining: tokenData.tokens_remaining, tokens_used: tokenData.tokens_used }).eq('user_id', user.id);
    return new Response(JSON.stringify({ error: 'Record generation failed — token refunded. Please try again.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ success: true, record: recordData, tokens_remaining: tokenData.tokens_remaining - 1 }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
