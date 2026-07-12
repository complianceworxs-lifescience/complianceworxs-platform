import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const GMAIL_CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const GMAIL_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const GMAIL_REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';
const FROM_NAME = 'ComplianceWorxs';
const FROM_EMAIL = 'jon@complianceworxs.com';
const REPLY_TO = 'jon@complianceworxs.com';
const DELIVERY_BCC = 'jon@complianceworxs.com';
const SUPPORT_EMAIL = 'support@complianceworxs.com';
const SITE = 'https://www.complianceworxs.com';

const RECONSTRUCTION_PREVENTION_STATEMENT =
  'This record was generated to document the authorization rationale contemporaneously with the operational decision in order to prevent post-inspection reconstruction of release justification.';

const DEFENSE_PACK_FIELDS = `,
  \"defense_pack_title\": \"Inspection Defense Package — [decision descriptor]\",
  \"defensibility_rating\": \"EXACTLY one of: Critical Exposure, At Risk, Defensible with Gaps, Inspection-Ready.\",
  \"executive_recommendation\": \"One to two sentences for a VP of Quality. State whether the decision is defensible, the single biggest exposure, and the action to take before inspection.\",
  \"executive_brief\": \"2-3 tight sentences a VP reads in under a minute: what was authorized, the basis, the single residual exposure. No filler.\",
  \"executive_brief_breakdown\": {
    \"decision\": \"What was authorized, by whom, when, on what subject. One sentence.\",
    \"basis\": \"The evidence and controls the authorization rested on. One sentence.\",
    \"exposure\": \"The specific inspection exposure(s) that remain. One sentence.\",
    \"required_action\": \"The concrete pre-inspection action that closes the exposure. One sentence.\"
  },
  \"evidence_matrix\": [
    {\"evidence\": \"Short evidence name\", \"source\": \"Originating system or record\", \"date\": \"Date or [Not specified]\", \"supports\": \"The conclusion this evidence supports\"}
  ],
  \"defensibility_analysis\": {
    \"critical_exposure\": [\"Each item: a gap that could sustain a 483. Empty array if none.\"],
    \"reconstruction_risk\": [\"Each item: a point an inspector could contest on reconstruction. Empty array if none.\"],
    \"recommended_remediation\": [{\"gap\": \"Short title of the missing documentation\", \"location\": \"The exact record or section where this documentation belongs\", \"purpose\": \"One sentence stating what this documentation must establish. Describe the documentation that WOULD close the gap — never assert it exists.\", \"template\": \"A fill-in DOCUMENTATION SCAFFOLD, never a finished paragraph. Output labeled fields and bullets the user completes. EVERY specific — value, result, ID, date, method, instrument or worksheet name, signatory, title, acceptance criterion — MUST be a bracketed blank such as [reference], [name], [date]. Use newlines between fields. Example shape: 'Analytical reports reviewed:\\\\n• Dissolution report: [reference]\\\\n• Assay report: [reference]\\\\n• Content uniformity report: [reference]\\\\nReviewer: [name]\\\\nReview date: [date]'. The template is a form to be filled, never prose that reads as complete. NEVER output a real or plausible specific.\", \"signatory\": \"Required signatory ROLE or null — the role, never an invented name\"}]
  },
  \"evidence_traceability\": [{\"evidence\": \"The evidence item or claimed result\", \"mentioned_in_rationale\": \"Yes or No\", \"attached_or_referenced\": \"Yes, No, or Referenced only\", \"inspection_risk\": \"Low, Medium, or High — risk this item creates if an investigator asks to see it\", \"needed_action\": \"What must be located, attached, or referenced to close the gap. Empty string if none.\"}],
  \"claim_status\": [{\"claim\": \"A specific factual claim stated in the rationale (a result, value, ID, or method)\", \"status\": \"EXACTLY one of: Claimed in rationale, Supported by attached evidence, Not traceable in record\"}],
  \"unsupported_claims\": [\"Each item: a statement this record does NOT substantiate, written as what the record fails to establish — never as advice on what to say or not say to an investigator. Example: This record does not establish that the f2 calculation was performed before authorization; no contemporaneous worksheet is attached.\"],
  \"inspector_challenge\": [{\"question\": \"A specific question an FDA investigator is likely to ask about THIS decision.\", \"inspection_risk\": \"EXACTLY one of: High, Likely follow-up, Medium, Low — how hard an investigator is likely to press this specific line.\", \"response\": \"The best supported response, written from the record. Grounded only in the inputs.\", \"weakness_to_acknowledge\": \"The weakness in this answer the responder should concede rather than conceal. Empty string if none.\", \"record_section_support\": \"Which record section or evidence item supports the response. Empty string if unsupported.\", \"do_not_overstate\": \"A specific claim the responder must NOT make because the record does not support it. Empty string if none.\"}]`;

const INDUSTRY_PROFILES: Record<string, any> = {
  pharma: { opening: 'You are a compliance record generator for FDA-regulated life sciences organizations (pharmaceutical, biologic, and medical device manufacturing).', primary_regs: '21 CFR 210/211 (cGMP), 21 CFR 820 (QSR), ICH Q7/Q9/Q10', decision_vocabulary: 'batch release, CAPA closure, deviation disposition, change control, validation decisions, OOS investigation closure', inspector_context: 'FDA investigators conducting pre-approval, BIMO, or routine GMP inspections', record_examples: 'batch records, deviation logs, CAPA forms, validation protocols, change control forms' },
  '503b': { opening: 'You are a compliance record generator for 503B Outsourcing Facilities — FDA-registered sterile compounding operations under Section 503B of the FD&C Act.', primary_regs: '21 CFR 210/211, USP <797>, USP <71>, USP <85>, USP <800>, USP <1116>, FDA 503B Guidance', decision_vocabulary: 'CSP batch release, EM excursion authorization, sterility OOS disposition, media fill failure investigation, BUD extension', inspector_context: 'FDA investigators conducting routine 503B inspections focused on sterility assurance and contamination control', record_examples: 'CSP batch records, EM data, sterility test records, media fill records, intervention logs' },
  food: { opening: 'You are a compliance record generator for FDA-regulated food manufacturing operations subject to FSMA preventive controls.', primary_regs: '21 CFR 117 (FSMA PCHF), 21 CFR 1 Subpart O, 21 CFR 120/123', decision_vocabulary: 'finished product release, CCP deviation handling, raw material acceptance, supplier verification, recall initiation', inspector_context: 'FDA investigators conducting food facility inspections under FSMA authority', record_examples: 'HACCP plan, CCP monitoring logs, CoAs, deviation records, supplier qualification files' },
  cosmetics: { opening: 'You are a compliance record generator for FDA-regulated cosmetics brands operating under MoCRA.', primary_regs: 'FD&C Act §605, §606, §607, §608, §609', decision_vocabulary: 'safety substantiation review, adverse event classification, ingredient or supplier change authorization, recall initiation', inspector_context: 'FDA investigators conducting inspections under MoCRA authority', record_examples: 'safety substantiation files, adverse event logs, product listings, facility registration records' },
};

function buildSystemPrompt(industry: string): string {
  const profile = INDUSTRY_PROFILES[industry] || INDUSTRY_PROFILES.pharma;
  const baseSections = `\n{\n  \"investigator_question\": \"The exact inspection-facing question, restated cleanly.\",\n  \"authorization_summary\": \"The decision, authorizing individual and title, operational context, timing. State if any element is missing.\",\n  \"evidence_reviewed\": [\"Array. One item per evidence_items entry. Format: 'Evidence — what it demonstrated [weight]'.\"],\n  \"risk_evaluation\": \"Known risks, residual risk, severity, impact, why residual risk remained acceptable. If not provided, state 'Not addressed in inputs.' Never invent.\",\n  \"alternatives_considered\": \"Alternative actions and why each was rejected, plus why the authorized path was selected. If none provided, state it and flag it.\",\n  \"authorization_rationale\": \"The core. How evidence was weighed, why sufficient, why authorization was justified at the time. Prosecutorial, evidence-linked. No generic QA boilerplate.\",\n  \"regulatory_alignment\": \"Map rationale to specific framework citations and SOPs supplied. Use ONLY the framework above. If no clear mapping, state that.\",\n  \"residual_exposure_statement\": \"Remaining uncertainties, dependencies, monitoring expectations. Avoid absolute-certainty language.\",\n  \"reconstruction_prevention_statement\": \"FIXED TEXT. Output exactly: ${RECONSTRUCTION_PREVENTION_STATEMENT}\",\n  \"known_limitations\": \"Assumptions, unavailable evidence, timing limitations, unresolved constraints. Be specific. List every gap.\",\n  \"gap_count\": 0,\n  \"flags\": [\n    {\"label\": \"FLAG LABEL IN CAPS — DESCRIPTOR\", \"type\": \"red\", \"section\": \"section_name\"}\n  ]${DEFENSE_PACK_FIELDS}\n}`;

  return `${profile.opening} Your only function is to produce a structured Inspection Response Record (IRR) AND its Inspection Defense Package wrapper from the user's structured decision inputs.\n\nREGULATORY CONTEXT:\n- Primary regulations: ${profile.primary_regs}\n- Typical decision types: ${profile.decision_vocabulary}\n- Inspector audience: ${profile.inspector_context}\n- Typical record types: ${profile.record_examples}\n\nWhen you cite regulatory alignment, use the framework above. If the input does not clearly map, state that in regulatory_alignment.\n\nMANDATORY RULES:\n1. Answer the exact investigator question first and directly, using only the structured inputs.\n2. Do not state facts not supported by the user's evidence.\n3. If key information is missing, state it in known_limitations and reflect it in gap_count.\n4. Do not invent dates, names, titles, evidence, regulations, or rationale not present in the input.\n5. Never use generic compliance boilerplate.\n6. Tone formal, neutral, inspection-grade.\n7. Be specific about every gap.\n8. gap_count must equal the number of distinct documentation gaps.\n9. evidence_reviewed MUST be built from evidence_items. If empty, return [\"No supporting evidence provided.\"] and flag it.\n10. The rationale MUST derive from the justification field.\n11. RESPONSE KIT IS A DOCUMENTATION SCAFFOLD, NOT FINISHED TEXT: recommended_remediation.template MUST be a fill-in form — labeled fields and bullets the user completes. Every specific (value, result, ID, date, method, instrument or worksheet name, signatory, title, acceptance criterion) MUST be a bracketed blank such as [reference], [name], [date]. NEVER write a finished paragraph and NEVER output a specific that reads as real. A gap exists precisely because the documentation is missing — scaffold it, never fabricate it. Fabricating a missing specific is the most serious failure this record can contain.\n\nDEFENSE PACK LAYER (always required):\n- Populate every defense-pack field: defense_pack_title, defensibility_rating, executive_recommendation, executive_brief, executive_brief_breakdown, evidence_matrix, evidence_traceability, claim_status, unsupported_claims, defensibility_analysis, inspector_challenge.\n- Same decision as the IRR; consistent with risk_evaluation, known_limitations, gap_count, flags. No new facts.\n- defensibility_rating EXACTLY one of: \"Critical Exposure\", \"At Risk\", \"Defensible with Gaps\", \"Inspection-Ready\".\n- evidence_matrix: one row per distinct evidence item. If none, [].\n- recommended_remediation is the RESPONSE KIT: one object per documentation gap. It SCAFFOLDS the missing documentation; it never writes it. template is a labeled fill-in form (fields and bullets) where every specific is a bracketed blank. purpose states what the documentation must establish, phrased as the documentation that WOULD close the gap — never asserting it exists. signatory is a role, never a name. Output a form to be completed, never prose that reads as a finished record.\n- inspector_challenge: for each likely FDA question, classify inspection_risk (High, Likely follow-up, Medium, or Low), then give the best supported response from the record, the weakness to acknowledge, the supporting record section, and the claim not to overstate. Grounded only in inputs. ARTIFACT ROLES — keep each deliverable distinct and do not restate the same exposure verbatim across them: executive_brief is the headline (what matters), defensibility_analysis is the reasoning (why it holds or fails), recommended_remediation is the documentation scaffold (what to fix), inspector_challenge is the interrogation (how an investigator presses it), and the IRR sections are the complete source record. State each point in its primary home and reference rather than repeat it elsewhere.\n- evidence_traceability: one row per evidence item or claimed result. State whether it is mentioned in the rationale, whether it is attached or only referenced, the inspection risk it carries, and the action needed. A result cited in the rationale with no evidence in the inputs is attached_or_referenced \"No\" and inspection_risk \"High\".\n- claim_status: classify each specific factual claim in the rationale as EXACTLY one of \"Claimed in rationale\", \"Supported by attached evidence\", or \"Not traceable in record\". A value cited without supporting evidence in the inputs is \"Not traceable in record\" — NEVER \"Supported by attached evidence\".\n- unsupported_claims: statements this record does NOT substantiate, each framed as what the record fails to establish. NEVER phrase these as coaching on what to say or not say to an investigator. Describe the record's limits, not inspection conduct.\n\nReturn ONLY a valid JSON object. No preamble. No markdown fences. Raw JSON only.\n${baseSections}\n\nFlag rules:\n- No formal authorization record: \"NO AUTHORIZATION RECORD — CRITICAL GAP\", red, \"known_limitations\".\n- Authorizer missing/lacks title: \"AUTHORITY GAP — DEFENSIBILITY FAILURE\", amber, \"authorization_summary\".\n- Evidence empty or under two items: \"INSUFFICIENT EVIDENCE — RECONSTRUCTION RISK\", red, \"evidence_reviewed\".\n- Justification under ~3 sentences or not tied to conclusion: \"JUSTIFICATION INSUFFICIENT — INSPECTION RISK\", amber, \"authorization_rationale\".\n- Only flag real gaps. gap_count must equal total distinct missing/weak items.`;
}

function formatEvidenceItems(items: any): string {
  if (!items) return 'None provided';
  if (Array.isArray(items)) { if (items.length === 0) return 'None provided'; return items.map((i: any) => `- ${typeof i === 'string' ? i : JSON.stringify(i)}`).join('\n'); }
  if (typeof items === 'string') return items.trim() || 'None provided';
  return 'None provided';
}

async function generateFullRecord(session: any): Promise<any> {
  const industry = (session.industry || 'pharma');
  const systemPrompt = buildSystemPrompt(industry);
  const evidenceBlock = formatEvidenceItems(session.evidence_items);
  const anchorsList = Array.isArray(session.regulatory_anchors) && session.regulatory_anchors.length ? session.regulatory_anchors.join(', ') : 'None selected by user';

  const metaBlock = `\nDECISION METADATA:\nFacility Name: ${session.facility_name || 'Not specified'}\nFacility Role: ${session.facility_role || 'Not specified'}\nReference ID: ${session.reference_id || 'Not specified'}\nApproving Role: ${session.approving_role || 'Not specified'}\nReview Participants: ${session.review_participants || 'Not specified'}\nEscalation Chain: ${session.escalation_chain || 'Not specified'}\nREGULATORY ANCHORS: ${anchorsList}\nAlternatives Considered: ${session.alternatives_considered || 'Not provided by user'}\nResidual Risk Accepted: ${session.residual_risk_accepted || 'Not provided by user'}\n`;

  const userMessage = `Generate an Inspection Response Record AND its Inspection Defense Package wrapper from the structured inputs below. Use only these inputs. Do not invent or fill gaps with boilerplate.\n\nINVESTIGATOR QUESTION:\n${session.question}\n\nDECISION TYPE: ${session.decision_type || 'Not specified'}\n\nDECISION STATEMENT:\n${session.decision_statement || 'Not specified'}\n\nREFERENCE ID:\n${session.reference_id || 'Not specified'}\n\nPRIMARY SOURCE RECORD:\n${session.source_record || session.context || 'Not provided'}\n\nEVIDENCE REVIEWED AT TIME OF DECISION:\n${evidenceBlock}\n\nWHAT THE AUTHORIZER REVIEWED:\n${session.authorizer_review || 'Not specified'}\n\nWHAT THE AUTHORIZER CONCLUDED:\n${session.authorizer_conclusion || 'Not specified'}\n\nAUTHORIZATION OWNER: ${session.authority_name ? `${session.authority_name}${session.authority_title ? ', ' + session.authority_title : ' (title not provided)'}` : 'Not specified'}\n\nDECISION DATE: ${session.decision_date || 'Not specified'}\n\nEVIDENCE AVAILABLE AT DECISION TIME: ${session.evidence_available === true ? 'Yes' : session.evidence_available === false ? 'No' : 'Not specified'}\n\nDECISION JUSTIFICATION:\n${session.justification || 'Not specified'}\n${metaBlock}\nReturn raw JSON only. Apply all flag rules. gap_count must be accurate. Populate every defense-pack field.`;

  const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 12000, system: systemPrompt, messages: [{ role: 'user', content: userMessage }] }),
  });
  const anthropicData = await anthropicResponse.json();
  if (anthropicData.error) throw new Error(anthropicData.error.message);
  const rawText = anthropicData?.content?.[0]?.text ?? '';
  const clean = rawText.replace(/```json|```/g, '').trim();
  const record = JSON.parse(clean);

  if (industry === '503b' || industry === 'pharma') record.reconstruction_prevention_statement = RECONSTRUCTION_PREVENTION_STATEMENT;
  const authorizerLabel = session.authority_name ? (session.authority_title ? `${session.authority_name}, ${session.authority_title}` : session.authority_name) : (session.approving_role || null);
  record.authorizer = authorizerLabel;
  record.decision_type = session.decision_type || record.decision_type || null;
  record.decision_date = session.decision_date || record.decision_date || null;
  if (!record.defense_pack_title) record.defense_pack_title = 'Inspection Defense Package' + (session.decision_type ? ' — ' + session.decision_type : '');
  record.document_id = 'CW-IDP-' + new Date().getFullYear() + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  if (!record.defensibility_analysis || typeof record.defensibility_analysis !== 'object') record.defensibility_analysis = { critical_exposure: [], reconstruction_risk: [], recommended_remediation: [] };
  if (!Array.isArray(record.evidence_matrix)) record.evidence_matrix = [];
  if (!Array.isArray(record.evidence_traceability)) record.evidence_traceability = [];
  if (!Array.isArray(record.claim_status)) record.claim_status = [];
  if (!Array.isArray(record.unsupported_claims)) record.unsupported_claims = [];
  if (!Array.isArray(record.inspector_challenge)) record.inspector_challenge = [];
  record._full = true;
  return record;
}

async function ensureFullRecord(supabase: any, sessionId: string): Promise<{ record?: any; generating?: boolean }> {
  const { data: fresh } = await supabase.from('irr_sessions').select('*').eq('id', sessionId).single();
  if (!fresh) throw new Error('Session not found during generation');

  if (fresh.record_json && fresh.record_json._full === true) return { record: fresh.record_json };

  const preview = fresh.record_json || {};
  const { data: claimed } = await supabase
    .from('irr_sessions')
    .update({ record_json: { ...preview, _full_lock: new Date().toISOString() } })
    .eq('id', sessionId)
    .filter('record_json->>_full_lock', 'is', null)
    .select('id');

  if (!claimed || claimed.length === 0) {
    const { data: recheck } = await supabase.from('irr_sessions').select('record_json').eq('id', sessionId).single();
    if (recheck?.record_json?._full === true) return { record: recheck.record_json };
    return { generating: true };
  }

  try {
    const fullRecord = await generateFullRecord(fresh);
    await supabase.from('irr_sessions').update({ record_json: fullRecord, gap_count: fullRecord.gap_count || 0, flags: fullRecord.flags || [] }).eq('id', sessionId);
    return { record: fullRecord };
  } catch (e) {
    await supabase.from('irr_sessions').update({ record_json: preview }).eq('id', sessionId);
    throw e;
  }
}

const PAGE_BY_INDUSTRY: Record<string, string> = {
  '503b': '/503b/irr', 'pharma': '/pharma/irr', 'cosmetics': '/cosmetics/irr',
  'food-beverage': '/food-beverage/irr', 'food_beverage': '/food-beverage/irr',
};
function recordUrlFor(session: any): string {
  const path = PAGE_BY_INDUSTRY[(session.industry ?? '').toString().trim().toLowerCase()] ?? '/irr';
  return `${SITE}${path}?session_id=${session.id}&payment=success`;
}
function formatCreditExpiry(iso: string | null): string | null {
  if (!iso) return null;
  try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/New_York' }) + ' ET'; } catch { return null; }
}
function buildDeliveryHtml(opts: { recordUrl: string; creditExpiry: string | null }): string {
  const { recordUrl, creditExpiry } = opts;
  const creditLine = creditExpiry
    ? `The $497 you just paid applies as a credit toward a ComplianceWorxs membership if you claim it by <strong>${creditExpiry}</strong>. Reply to this email and we'll apply it.`
    : `The $497 you just paid applies as a credit toward a ComplianceWorxs membership if you claim it within 48 hours. Reply to this email and we'll apply it.`;
  return `<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1C2733;\">\n<p style=\"font-size:16px;line-height:1.6;margin:0 0 18px 0;\">Your Inspection Response Record is ready.</p>\n<p style=\"font-size:16px;line-height:1.6;margin:0 0 24px 0;\">This is the record an investigator's question reduces to &mdash; who authorized the decision, on what evidence, and why it held. The link below is permanent. Save it. The moment it matters is the inspection, not today.</p>\n<p style=\"margin:0 0 26px 0;\"><a href=\"${recordUrl}\" style=\"display:inline-block;background:#0E6F86;color:#FFFFFF;text-decoration:none;padding:14px 28px;font-weight:600;font-size:15px;border-radius:6px;letter-spacing:0.01em;\">Open your record</a></p>\n<p style=\"font-size:13px;line-height:1.6;margin:0 0 6px 0;color:#5E6B75;\">If the button doesn't work, paste this into your browser:</p>\n<p style=\"font-size:12px;line-height:1.5;margin:0 0 24px 0;color:#5E6B75;word-break:break-all;\">${recordUrl}</p>\n<p style=\"font-size:14px;line-height:1.6;margin:0 0 24px 0;\">The record stays available at that link. Bookmark it, or forward it to whoever owns the file during an inspection.</p>\n<div style=\"background:#F7F5F0;border-left:3px solid #F7C51E;padding:16px 18px;margin:0 0 26px 0;border-radius:2px;\"><p style=\"font-size:14px;line-height:1.6;margin:0;color:#1C2733;\"><strong>Your purchase includes a credit.</strong> ${creditLine}</p></div>\n<div style=\"background:#F4F6F7;border-left:3px solid #0E6F86;padding:14px 18px;margin:0 0 28px 0;border-radius:2px;\"><p style=\"font-size:13px;line-height:1.55;margin:0;color:#1C2733;\"><strong>Can't open your record?</strong> Email <a href=\"mailto:${SUPPORT_EMAIL}\" style=\"color:#0E6F86;text-decoration:underline;\">${SUPPORT_EMAIL}</a> and we'll get it to you directly.</p></div>\n<hr style=\"border:none;border-top:1px solid #E5E5E5;margin:0 0 20px 0;\">\n<p style=\"font-size:14px;line-height:1.6;margin:0 0 2px 0;\">&mdash; ComplianceWorxs</p>\n<p style=\"font-size:13px;line-height:1.6;margin:0;color:#5E6B75;\">The Record Behind the Decision &middot; complianceworxs.com</p>\n</div>`;
}
async function getGmailAccessToken(): Promise<string | null> {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) return null;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET, refresh_token: GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return (await r.json())?.access_token ?? null;
  } catch { return null; }
}
function buildRawHtmlEmail(toEmail: string, subject: string, html: string): string {
  const messageId = `<${crypto.randomUUID()}@complianceworxs.com>`;
  const encodedSubject = /[^\x20-\x7E]/.test(subject) ? `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=` : subject;
  const lines = [`From: \"${FROM_NAME}\" <${FROM_EMAIL}>`, `To: <${toEmail}>`, `Bcc: ${DELIVERY_BCC}`, `Reply-To: ${REPLY_TO}`, `Subject: ${encodedSubject}`, `Message-ID: ${messageId}`, `MIME-Version: 1.0`, `Content-Type: text/html; charset=\"UTF-8\"`, `Content-Transfer-Encoding: 8bit`, ``, html];
  const raw = lines.join('\r\n');
  return btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sendDeliveryEmail(supabase: any, session: any, email: string | null): Promise<void> {
  try {
    if (!email || session.delivery_email_sent_at || !GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) return;
    const { data: claimed } = await supabase.from('irr_sessions').update({ delivery_email_sent_at: new Date().toISOString() }).eq('id', session.id).is('delivery_email_sent_at', null).select('id');
    if (!claimed || claimed.length === 0) return;
    const recordUrl = recordUrlFor(session);
    const html = buildDeliveryHtml({ recordUrl, creditExpiry: formatCreditExpiry(session.membership_credit_expires_at) });
    let sent = false; let gmailId: string | null = null; let sendError: string | null = null;
    const token = await getGmailAccessToken();
    if (!token) { sendError = 'gmail_token_failed'; }
    else {
      try {
        const raw = buildRawHtmlEmail(email, 'Your Inspection Response Record is ready', html);
        const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }), signal: AbortSignal.timeout(15000) });
        if (res.ok) { sent = true; gmailId = (await res.json())?.id ?? null; } else { sendError = `gmail_${res.status}: ${(await res.text()).slice(0, 200)}`; }
      } catch (e) { sendError = e instanceof Error ? e.message : String(e); }
    }
    if (!sent) await supabase.from('irr_sessions').update({ delivery_email_sent_at: null }).eq('id', session.id);
    try { await supabase.from('events').insert({ session_id: `irr:${session.id}`, event_name: 'irr_delivered', page: recordUrl, properties: { email, industry: session.industry ?? null, email_sent: sent, gmail_message_id: gmailId, email_error: sendError, provider: 'gmail' } }); } catch (_e) {}
  } catch (_e) {}
}

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { session_id, stripe_session_id } = await req.json();
    if (!session_id) return new Response(JSON.stringify({ error: 'session_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: session, error } = await supabase.from('irr_sessions').select('*').eq('id', session_id).single();
    if (error || !session) return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    let paid = session.paid === true;
    let creditExpiry = session.membership_credit_expires_at;
    let deliverEmail = session.email;
    let emailSession = session;

    if (!paid && stripe_session_id) {
      const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${stripe_session_id}`, { headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` } });
      const stripeSession = await stripeRes.json();
      if (stripeSession.payment_status === 'paid' && stripeSession.metadata?.irr_session_id === session_id) {
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        const customerEmail = stripeSession.customer_details?.email || null;
        await supabase.from('irr_sessions').update({ paid: true, stripe_session_id, stripe_payment_intent: stripeSession.payment_intent, email: customerEmail, membership_credit_expires_at: expiresAt }).eq('id', session_id);
        paid = true; creditExpiry = expiresAt; deliverEmail = customerEmail;
        emailSession = { ...session, email: customerEmail, membership_credit_expires_at: expiresAt };
      }
    }

    if (!paid) return new Response(JSON.stringify({ unlocked: false, error: 'Payment not confirmed' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const result = await ensureFullRecord(supabase, session_id);
    if (result.generating) return new Response(JSON.stringify({ unlocked: true, generating: true, membership_credit_expires_at: creditExpiry }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    await sendDeliveryEmail(supabase, emailSession, deliverEmail);

    return new Response(JSON.stringify({ unlocked: true, record: result.record, membership_credit_expires_at: creditExpiry }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});