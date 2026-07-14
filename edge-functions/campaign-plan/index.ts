import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const PROMPT_VERSION = 'campaign-planner-v1.0.1';
const MODEL = 'claude-sonnet-4-5';

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

const SYSTEM_PROMPT = `You generate a campaign thesis, behavioral commitment, and success metric for ComplianceWorxs, a company that sells the Inspection Response Record (IRR) and membership. Campaign sequence is always Belief → Objection → Activation Event → Decision Type → Campaign. The behavioral commitment must be a specific, observable action by a named role — not a vague intention. Example: "VP Quality agrees to review one real Batch Release using the IRR," not "VP Quality becomes interested." If activation_event is null, fold a note about the missing urgency directly into the campaign_thesis field itself — do not add any sentence, caveat, or explanation outside the JSON object. Do not invent a belief, objection, or decision type not supplied.
Banned terms: DDR, Decision Defense Record, decision defensibility, "platform" as product descriptor, authorization framework, AI, automation, leverage.
Your entire response must be exactly one JSON object and nothing else — no markdown fences, no preamble, no trailing commentary, no text before the opening brace or after the closing brace:
{"campaign_thesis": "string", "behavioral_commitment": "string", "success_metric": "string"}`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { belief_id, objection_id, activation_event_id, decision_type, target_account_id } = body;

  if (!belief_id || !objection_id) {
    return jsonResponse({ error: 'campaign requires belief_id and objection_id' }, 422);
  }
  if (!decision_type) {
    return jsonResponse({ error: 'campaign requires decision_type' }, 422);
  }

  const { data: belief, error: beliefError } = await supabase
    .from('beliefs')
    .select('belief_statement')
    .eq('belief_id', belief_id)
    .single();

  if (beliefError || !belief) {
    return jsonResponse({ error: `belief_id ${belief_id} not found` }, 404);
  }

  const { data: objection, error: objectionError } = await supabase
    .from('objections')
    .select('objection_statement')
    .eq('objection_id', objection_id)
    .single();

  if (objectionError || !objection) {
    return jsonResponse({ error: `objection_id ${objection_id} not found` }, 404);
  }

  let activationEventType: string | null = null;
  if (activation_event_id) {
    const { data: activationEvent } = await supabase
      .from('activation_events')
      .select('event_type')
      .eq('activation_event_id', activation_event_id)
      .single();
    activationEventType = activationEvent?.event_type ?? null;
  }

  const userMessage = `Belief: ${belief.belief_statement}
Objection: ${objection.objection_statement}
Activation event: ${activationEventType ?? 'none provided'}
Decision type: ${decision_type}
Target account: ${target_account_id ?? 'not provided'}

Produce:
1. campaign_thesis (2-3 sentences, states how this campaign proves the objection false using this decision type)
2. behavioral_commitment (one sentence, a specific observable action by a named role)
3. success_metric (one sentence, must be one of: executive meeting, IRR request, membership discussion, membership close)`;

  const logInput = {
    belief_id, objection_id, activation_event_id: activation_event_id ?? null,
    decision_type, target_account_id: target_account_id ?? null,
    belief_statement: belief.belief_statement, objection_statement: objection.objection_statement,
    activation_event_type: activationEventType,
  };

  let anthropicData: any;
  try {
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    anthropicData = await anthropicResponse.json();
    if (anthropicData.error) throw new Error(anthropicData.error.message);
  } catch (err) {
    await supabase.from('ai_service_log').insert({
      service_name: 'campaign_planner',
      input: logInput,
      output: null,
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      error_state: String(err.message ?? err),
    });
    return jsonResponse({ error: 'Campaign Planner model call failed', detail: String(err.message ?? err) }, 500);
  }

  const rawText = anthropicData?.content?.[0]?.text ?? '';
  const fenceStripped = rawText.replace(/```json|```/g, '').trim();
  const firstBrace = fenceStripped.indexOf('{');
  const lastBrace = fenceStripped.lastIndexOf('}');
  const clean = (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace)
    ? fenceStripped.slice(firstBrace, lastBrace + 1)
    : fenceStripped;

  let parsed: { campaign_thesis?: string; behavioral_commitment?: string; success_metric?: string };
  try {
    parsed = JSON.parse(clean);
  } catch {
    await supabase.from('ai_service_log').insert({
      service_name: 'campaign_planner',
      input: logInput,
      output: { raw: rawText },
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      error_state: 'model output was not valid JSON',
    });
    return jsonResponse({ error: 'Campaign Planner produced an unparseable response' }, 500);
  }

  if (!parsed.campaign_thesis || !parsed.behavioral_commitment || !parsed.success_metric) {
    await supabase.from('ai_service_log').insert({
      service_name: 'campaign_planner',
      input: logInput,
      output: parsed,
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      error_state: 'model response missing one or more required fields',
    });
    return jsonResponse({ error: 'Campaign Planner response incomplete', detail: parsed }, 500);
  }

  await supabase.from('ai_service_log').insert({
    service_name: 'campaign_planner',
    input: logInput,
    output: parsed,
    model: MODEL,
    prompt_version: PROMPT_VERSION,
    error_state: null,
  });

  const { data: campaign, error: insertError } = await supabase
    .from('campaigns')
    .insert({
      belief_id,
      objection_id,
      activation_event_id: activation_event_id ?? null,
      decision_type,
      campaign_thesis: parsed.campaign_thesis,
      behavioral_commitment: parsed.behavioral_commitment,
      success_metric: parsed.success_metric,
      status: 'draft',
    })
    .select('campaign_id')
    .single();

  if (insertError || !campaign) {
    return jsonResponse({ error: 'Failed to save campaign', detail: insertError?.message }, 500);
  }

  return jsonResponse({
    campaign_id: campaign.campaign_id,
    campaign_thesis: parsed.campaign_thesis,
    behavioral_commitment: parsed.behavioral_commitment,
    success_metric: parsed.success_metric,
    status: 'draft',
  }, 201);
});
