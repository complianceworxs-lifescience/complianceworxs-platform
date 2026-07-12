import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer, accept, accept-profile, content-profile',
  'Access-Control-Max-Age': '86400',
};

const INDUSTRY_CONTEXT: Record<string, string> = {
  pharma: 'FDA-regulated pharma/biologic/device GMP. Regs: 21 CFR 210/211, 820, ICH Q7/Q9/Q10. Decisions: batch release, CAPA closure, deviation disposition, change control, OOS closure.',
  '503b': '503B sterile compounding under cGMP + USP <797>/<71>/<85>/<800>. Decisions: CSP batch release, EM excursion, sterility OOS, media fill failure, BUD extension. Sterility assurance is the core exposure.',
  food: 'FDA food under FSMA (21 CFR 117). Decisions: finished product release, CCP deviation, raw material acceptance, supplier verification, recall.',
  cosmetics: 'FDA cosmetics under MoCRA (FD&C Act 605-609). Decisions: safety substantiation, adverse event classification, ingredient/supplier change, recall.',
};

const SECTION_HEADERS: Record<string, string[]> = {
  '503b': ['Investigator Question', 'Authorization Summary', 'Evidence Reviewed', 'Risk Evaluation', 'Authorization Rationale', 'Regulatory Alignment', 'Residual Exposure Statement', 'Reconstruction Prevention Statement'],
  pharma: ['Investigator Question', 'Authorization Summary', 'Evidence Reviewed', 'Risk Evaluation', 'Alternatives Considered', 'Authorization Rationale', 'Regulatory Alignment', 'Residual Exposure Statement', 'Reconstruction Prevention Statement', 'Known Limitations'],
  cosmetics: ['Regulatory Question', 'Authorization Summary', 'Evidence Reviewed', 'Risk Evaluation', 'Alternatives Considered', 'Authorization Rationale', 'MoCRA Alignment', 'Residual Exposure Statement', 'Future Risk Controls', 'Known Limitations'],
  food: ['Inspection Question', 'Authorization Summary', 'Evidence Reviewed', 'Hazard and Risk Evaluation', 'Alternatives Considered', 'Authorization Rationale', 'Regulatory Alignment', 'Residual Exposure Statement', 'Ongoing Control Commitments', 'Known Limitations'],
  default: ['Direct Answer', 'Authorization Reference', 'Evidence Reviewed', 'Justification Statement', 'Regulatory Alignment', 'Residual Risk Position', 'Known Limitations'],
};

function formatEvidenceItems(items: any): string {
  if (!items) return 'None provided';
  if (Array.isArray(items)) {
    if (items.length === 0) return 'None provided';
    return items.map((i: any) => `- ${typeof i === 'string' ? i : JSON.stringify(i)}`).join('\n');
  }
  if (typeof items === 'string') return items.trim() || 'None provided';
  return 'None provided';
}

function normalizeIndustry(input: any): string {
  if (typeof input !== 'string') return 'pharma';
  const n = input.toLowerCase().trim();
  if (n === '503b' || n === '503-b' || n === 'outsourcing_facility' || n === 'compounding') return '503b';
  if (n === 'food' || n === 'f&b' || n === 'food_and_beverage' || n === 'food-beverage' || n === 'food & beverage') return 'food';
  if (n === 'cosmetics' || n === 'cosmetic') return 'cosmetics';
  return 'pharma';
}

function buildPreviewPrompt(industry: string): string {
  const ctx = INDUSTRY_CONTEXT[industry] || INDUSTRY_CONTEXT.pharma;
  return `You are an FDA-compliance gap analyzer. Industry context: ${ctx}\n\nGiven a regulated decision's inputs, identify the documentation gaps an FDA investigator would flag and summarize the decision in one sentence. Do NOT write the full record. Work only from the inputs supplied; never invent facts.\n\nReturn ONLY a raw JSON object, no markdown, no preamble:\n{\n  \"summary\": \"One sentence: what was authorized, by whom, and the single biggest inspection exposure. Grounded only in the inputs.\",\n  \"gap_count\": 0,\n  \"flags\": [{\"label\": \"FLAG LABEL IN CAPS — DESCRIPTOR\", \"type\": \"red\", \"section\": \"section_name\"}]\n}\n\nFlag rules (apply all that fit the inputs):\n- No formal authorization record referenced: \"NO AUTHORIZATION RECORD — CRITICAL GAP\", red.\n- Authorizer missing or lacks a title: \"AUTHORITY GAP — DEFENSIBILITY FAILURE\", amber.\n- Evidence empty or fewer than two items: \"INSUFFICIENT EVIDENCE — RECONSTRUCTION RISK\", red.\n- Justification under ~3 sentences or does not tie evidence to conclusion: \"JUSTIFICATION INSUFFICIENT — INSPECTION RISK\", amber.\n- Alternatives not documented: \"ALTERNATIVES NOT DOCUMENTED — INVESTIGATION GAP\", amber.\n- Evidence not available at decision time: \"EVIDENCE NOT AVAILABLE AT DECISION TIME — CRITICAL\", red.\n- Decision date missing: \"DECISION DATE NOT STATED — TIMING GAP\", amber.\nOnly flag real gaps from the inputs. gap_count must equal the number of distinct flags.`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      question, decision_type, decision_statement, reference_id, source_record, evidence_items,
      authorizer_review, authorizer_conclusion, authority_name, authority_title, decision_date,
      evidence_available, justification, context, email, industry, facility_name, fei_number,
      facility_role, sterile_operation_type, lot_number, product_name, deviation_id, investigation_id,
      event_datetime, release_date, approving_role, review_participants, escalation_chain,
      regulatory_anchors, attached_documents, contamination_risk_assessment, alternatives_considered,
      residual_risk_accepted,
    } = body;

    if (!question || question.trim().length < 10) {
      return new Response(JSON.stringify({ error: 'Inspector question is required (min 10 characters).' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const resolvedIndustry = normalizeIndustry(industry);
    const is503b = resolvedIndustry === '503b';
    const priceCents = 49700;
    const evidenceBlock = formatEvidenceItems(evidence_items);

    const previewUserMessage = `Analyze the documentation gaps in this decision and summarize it in one sentence. Inputs only; never invent.\n\nINVESTIGATOR QUESTION:\n${question}\n\nDECISION TYPE: ${decision_type || 'Not specified'}\nDECISION STATEMENT: ${decision_statement || 'Not specified'}\nREFERENCE ID: ${reference_id || 'Not specified'}\n\nEVIDENCE AT DECISION TIME:\n${evidenceBlock}\n\nAUTHORIZATION OWNER: ${authority_name ? `${authority_name}${authority_title ? ', ' + authority_title : ' (title not provided)'}` : 'Not specified'}\nDECISION DATE: ${decision_date || 'Not specified'}\nEVIDENCE AVAILABLE AT DECISION TIME: ${evidence_available === true ? 'Yes' : evidence_available === false ? 'No' : 'Not specified'}\nALTERNATIVES CONSIDERED: ${alternatives_considered || 'Not provided'}\n\nDECISION JUSTIFICATION:\n${justification || 'Not specified'}\n\nReturn raw JSON only per the schema.`;

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1500, system: buildPreviewPrompt(resolvedIndustry), messages: [{ role: 'user', content: previewUserMessage }] }),
    });

    const anthropicData = await anthropicResponse.json();
    if (anthropicData.error) throw new Error(anthropicData.error.message);

    const rawText = anthropicData?.content?.[0]?.text ?? '';
    const clean = rawText.replace(/```json|```/g, '').trim();
    let preview: any;
    try { preview = JSON.parse(clean); } catch { preview = { summary: 'Preview generated.', gap_count: 0, flags: [] }; }

    const previewRecord = {
      _preview: true,
      summary: preview.summary || '',
      gap_count: typeof preview.gap_count === 'number' ? preview.gap_count : (Array.isArray(preview.flags) ? preview.flags.length : 0),
      flags: Array.isArray(preview.flags) ? preview.flags : [],
    };

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const insertData: any = {
      question, context: context || null, decision_type: decision_type || null, decision_statement: decision_statement || null,
      reference_id: reference_id || null, source_record: source_record || null,
      evidence_items: Array.isArray(evidence_items) ? evidence_items : (evidence_items ? [evidence_items] : null),
      authorizer_review: authorizer_review || null, authorizer_conclusion: authorizer_conclusion || null,
      authority_name: authority_name || null, authority_title: authority_title || null, decision_date: decision_date || null,
      evidence_available: typeof evidence_available === 'boolean' ? evidence_available : null,
      justification: justification || null, email: email || null, record_json: previewRecord,
      gap_count: previewRecord.gap_count, flags: previewRecord.flags, industry: resolvedIndustry, price_cents: priceCents,
    };

    if (is503b) {
      insertData.facility_name = facility_name || null;
      insertData.fei_number = fei_number || null;
      insertData.facility_role = facility_role || null;
      insertData.sterile_operation_type = sterile_operation_type || null;
      insertData.lot_number = lot_number || null;
      insertData.product_name = product_name || null;
      insertData.deviation_id = deviation_id || null;
      insertData.investigation_id = investigation_id || null;
      insertData.event_datetime = event_datetime || null;
      insertData.release_date = release_date || null;
      insertData.approving_role = approving_role || null;
      insertData.review_participants = review_participants || null;
      insertData.escalation_chain = escalation_chain || null;
      insertData.regulatory_anchors = Array.isArray(regulatory_anchors) ? regulatory_anchors : [];
      insertData.attached_documents = Array.isArray(attached_documents) ? attached_documents : [];
      insertData.contamination_risk_assessment = contamination_risk_assessment || null;
      insertData.alternatives_considered = alternatives_considered || null;
      insertData.residual_risk_accepted = residual_risk_accepted || null;
    } else {
      insertData.approving_role = approving_role || null;
      insertData.alternatives_considered = alternatives_considered || null;
      insertData.residual_risk_accepted = residual_risk_accepted || null;
      insertData.regulatory_anchors = Array.isArray(regulatory_anchors) ? regulatory_anchors : [];
    }

    const { data: sessions, error: insertError } = await supabase.from('irr_sessions').insert(insertData).select('id').single();
    if (insertError) throw new Error('Failed to save session: ' + insertError.message);

    const sectionHeaders = SECTION_HEADERS[resolvedIndustry] || SECTION_HEADERS.default;

    return new Response(JSON.stringify({
      session_id: sessions.id, industry: resolvedIndustry, price_cents: priceCents,
      partial: {
        question, direct_answer_preview: previewRecord.summary, gap_count: previewRecord.gap_count,
        flags: previewRecord.flags, section_headers: sectionHeaders,
        defensibility_rating: null, defense_pack_title: null,
      }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});