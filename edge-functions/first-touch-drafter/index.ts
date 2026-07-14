// first-touch-drafter v31 — FIXES: fit floor split + email gate removed
//
// v30 → v31 CHANGES:
//   FIX 3: FIT_SCORE_FLOOR split: template-path leads use 70, Gemini-path uses 80
//          (template costs $0 so no reason to hold it at 80)
//   FIX 5: Removed .not('email', 'is', null) filter from batch query
//          DM path does not require email. Template path A works without email.
//   All other v30 behavior preserved.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const BATCH_SIZE_DEFAULT = 10;
const FIT_SCORE_FLOOR_TEMPLATE = 70;  // FIX 3: template path floor (was 80)
const FIT_SCORE_FLOOR_GEMINI = 80;    // FIX 3: Gemini path floor unchanged
const ANTHROPIC_RESEARCH_MODEL = 'claude-sonnet-4-5-20250929';
const GEMINI_WRITE_MODEL = 'gemini-2.5-flash';
const RESEARCH_TIMEOUT_MS = 35000;
const WRITE_TIMEOUT_MS = 15000;
const BATCH_STAGGER_MS = 600;

const COMPLEX_PROFILE_DESC_THRESHOLD = 200;

const LEAD_SELECT_COLS = `id, full_name, email, job_title, company, company_domain,
  case_file_interest, fit_score, first_touch_draft_body, linkedin_url,
  linkedin_headline, linkedin_description, linkedin_company_industry,
  linkedin_location, linkedin_company_employees_count, linkedin_company_headquarter,
  industry, role_function, role_seniority, primary_authorization_domain, cohort_label`;

const SUBJECT_POOLS: Record<string, string[]> = {
  'Batch Release': ['Who signed the release decision?', 'The batch release authorization gap', 'On a question your inspector will ask'],
  'Process Validation': ['Who authorized the validation conclusion?', 'A question on your validation closure', 'On the signed-off-but-undefended pattern'],
  'Change Control': ['Who approved the change risk?', 'On change control authorization', 'A question on your change risk record'],
  'CAPA': ['Who closed the CAPA?', 'On CAPA effectiveness authorization', 'A question on your CAPA closure record'],
  'Deviation': ['Who authorized the disposition?', 'On the deviation disposition record', 'A question on your deviation closure'],
  'OOS': ['Who authorized the OOS conclusion?', 'On OOS investigation authorization', 'A question on your OOS disposition'],
  'Data Integrity': ['Who authorized the data review?', 'On data integrity sign-off', 'A question on your DI authorization record'],
  'Supplier Qualification': ['Who qualified the supplier?', 'On supplier qualification authorization', 'A question on your qualification record'],
  'Stability OOT': ['Who authorized the OOT conclusion?', 'On stability OOT disposition', 'A question on your OOT record'],
  'Complaint': ['Who closed the complaint?', 'On complaint investigation closure', 'A question on your complaint disposition'],
  'default': ['Who authorized the call?', 'On the authorization gap', 'A question your inspector will ask'],
};

const CASE_FILE_URLS: Record<string, string> = {
  'Batch Release': 'https://cases.complianceworxs.com/batch-release-authorization',
  'Process Validation': 'https://cases.complianceworxs.com/process-validation-conclusion',
  'Change Control': 'https://cases.complianceworxs.com/change-control-risk',
  'CAPA': 'https://cw-inspection-case-files.vercel.app/capa-effectiveness',
  'Deviation': 'https://cases.complianceworxs.com/deviation-root-cause',
  'OOS': 'https://cases.complianceworxs.com/oos-investigation',
  'Data Integrity': 'https://cases.complianceworxs.com/data-integrity',
  'Supplier Qualification': 'https://cases.complianceworxs.com/supplier-qualification',
  'Stability OOT': 'https://cases.complianceworxs.com/stability-oot',
  'Complaint': 'https://cases.complianceworxs.com/complaint-investigation',
};

const DOMAIN_MAP: Record<string, string> = {
  'batch_release': 'batch_release',
  'change_control': 'change_control',
  'deviation': 'deviation',
  'capa': 'capa',
  'oos_oot': 'oos_oot',
  'supplier_qualification': 'supplier_qualification',
  'data_integrity': 'data_integrity',
};

function normalizeCaseFile(raw: string | null): string {
  if (!raw) return 'default';
  const map: Record<string, string> = {
    'Batch Release Authorization': 'Batch Release', 'batch-release-authorization': 'Batch Release',
    'CAPA Effectiveness': 'CAPA', 'capa-effectiveness': 'CAPA',
    'Deviation Root Cause': 'Deviation', 'Change Control Risk': 'Change Control',
    'OOS Investigation': 'OOS', 'data-integrity': 'Data Integrity',
    'supplier-qualification': 'Supplier Qualification', 'Complaint Investigation': 'Complaint',
  };
  return map[raw] || raw;
}

function pickSubject(cohort: string, leadId: number): string {
  const pool = SUBJECT_POOLS[cohort] || SUBJECT_POOLS['default'];
  return pool[leadId % pool.length];
}

function cohortDecisionType(cohort: string): string {
  const map: Record<string, string> = {
    'Batch Release': 'lot release decisions', 'Process Validation': 'validation conclusions',
    'Change Control': 'change risk acceptance decisions', 'CAPA': 'CAPA effectiveness closures',
    'Deviation': 'deviation dispositions', 'OOS': 'OOS investigation conclusions',
    'Data Integrity': 'data integrity reviews', 'Supplier Qualification': 'supplier qualification approvals',
    'Stability OOT': 'stability OOT conclusions', 'Complaint': 'complaint closures',
    'default': 'compliance authorization decisions',
  };
  return map[cohort] || map['default'];
}

async function classifyLead(lead: any): Promise<{ domain: string; method: string }> {
  const existing = lead.primary_authorization_domain;
  if (existing && DOMAIN_MAP[existing]) {
    return { domain: DOMAIN_MAP[existing], method: 'existing_field' };
  }
  const cfi = (lead.case_file_interest || '').toLowerCase();
  if (cfi.includes('batch')) return { domain: 'batch_release', method: 'case_file_inference' };
  if (cfi.includes('change')) return { domain: 'change_control', method: 'case_file_inference' };
  if (cfi.includes('deviation')) return { domain: 'deviation', method: 'case_file_inference' };
  if (cfi.includes('capa')) return { domain: 'capa', method: 'case_file_inference' };
  if (cfi.includes('oos') || cfi.includes('oot')) return { domain: 'oos_oot', method: 'case_file_inference' };
  if (cfi.includes('supplier')) return { domain: 'supplier_qualification', method: 'case_file_inference' };
  if (cfi.includes('data integrity')) return { domain: 'data_integrity', method: 'case_file_inference' };
  const title = (lead.job_title || '').toLowerCase();
  const role = (lead.role_function || '').toLowerCase();
  if (role === 'validation' || title.includes('csv') || title.includes('validation')) {
    return { domain: 'change_control', method: 'role_inference' };
  }
  if (role === 'manufacturing' || title.includes('manufacturing') || title.includes('production')) {
    return { domain: 'batch_release', method: 'role_inference' };
  }
  return { domain: 'generic', method: 'default' };
}

function isComplexProfile(lead: any): boolean {
  const descLen = (lead.linkedin_description || '').length;
  const hasHeadline = !!(lead.linkedin_headline);
  const hasIndustry = !!(lead.linkedin_company_industry);
  return descLen > COMPLEX_PROFILE_DESC_THRESHOLD && hasHeadline && hasIndustry;
}

async function getTemplate(supabase: any, domain: string, roleFunction: string | null): Promise<any | null> {
  if (roleFunction) {
    const { data } = await supabase
      .from('dm_templates')
      .select('*')
      .eq('authorization_domain', domain)
      .eq('role_target', roleFunction)
      .eq('is_active', true)
      .order('performance_score', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  const { data } = await supabase
    .from('dm_templates')
    .select('*')
    .eq('authorization_domain', domain)
    .is('role_target', null)
    .eq('is_active', true)
    .order('performance_score', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data) return data;
  const { data: generic } = await supabase
    .from('dm_templates')
    .select('*')
    .eq('authorization_domain', 'generic')
    .eq('is_active', true)
    .order('performance_score', { ascending: false })
    .limit(1)
    .maybeSingle();
  return generic || null;
}

function injectTemplate(template: string, lead: any): string {
  const first = (lead.full_name || '').split(' ')[0] || '';
  const company = lead.company || 'your organization';
  const title = lead.job_title || 'your role';
  return template
    .replace(/{first_name}/g, first)
    .replace(/{company}/g, company)
    .replace(/{job_title}/g, title)
    .replace(/{decision_type}/g, 'a critical compliance decision');
}

function isValidResearchSignal(text: string, companyName: string): boolean {
  if (!text || text.length < 80) return false;
  if (/^[.,;:!?\-—–'"\s]/.test(text)) return false;
  const companyFirstWord = companyName.split(/\s+/)[0];
  if (companyFirstWord.length >= 3 && !text.toLowerCase().includes(companyFirstWord.toLowerCase())) return false;
  return true;
}

const RESEARCH_SYSTEM_PROMPT = `You are a research agent for Jon Nugent, founder of ComplianceWorxs (an FDA inspection-defense platform for life sciences QA and Regulatory leaders).

Your job: for each cold-email recipient, find ONE specific, recent (last 18 months), named, verifiable signal that gives this person a real reason to care about inspection authorization records right now.

You will be given the recipient's name, title, company, and their LinkedIn headline, professional bio, industry segment, and role function. USE THESE to focus your search.

INDUSTRY-SPECIFIC SEARCH ANGLES:
  PHARMA/BIOTECH: FDA 483s, warning letters, NDA/BLA filings, PAI prep, product launches, recalls
  CDMO: Client audit observations, OAI/VAI status, capacity expansions
  MEDICAL DEVICE: MDSAP audit failures, 510k holds, PMA observations, EU MDR findings, recalls

EDITORIAL FILTER — REJECT (return NONE if only these found):
  X1) Bankruptcy/going-concern X2) Program discontinuations X3) Layoffs/RIFs
  X4) Facility closures X5) Recent executive departures X6) Acquisition disruption
  X7) Personal crises X8) Active recalls still being managed

Use web_search. STOP after finding ONE usable signal. Max 4 searches.

Return ONLY: one complete 1-2 sentence signal description naming company + source, OR the literal string NONE.`;

async function researchSignal(lead: any, cohort: string): Promise<{ research_text: string | null; debug: any }> {
  const decisionType = cohortDecisionType(cohort);
  const debug: any = { stage: 'anthropic_research', model: ANTHROPIC_RESEARCH_MODEL };
  const segments = [
    `RECIPIENT: ${lead.full_name} | ${lead.job_title} | ${lead.company}`,
    lead.linkedin_headline ? `Headline: ${lead.linkedin_headline}` : '',
    lead.linkedin_description ? `Bio: ${String(lead.linkedin_description).slice(0, 400)}` : '',
    lead.role_function ? `Role: ${lead.role_seniority || ''} ${lead.role_function}` : '',
    lead.linkedin_company_industry ? `Industry: ${lead.linkedin_company_industry}` : '',
    `DECISION TYPE: ${decisionType}`,
  ].filter(Boolean).join('\n');

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: ANTHROPIC_RESEARCH_MODEL, max_tokens: 3000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
        system: [{ type: 'text', text: RESEARCH_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: segments }],
      }),
      signal: AbortSignal.timeout(RESEARCH_TIMEOUT_MS),
    });
    debug.status = r.status;
    if (!r.ok) { debug.error = (await r.text()).slice(0, 400); debug.api_error = true; return { research_text: null, debug }; }
    const body = await r.json();
    debug.stop_reason = body.stop_reason;
    debug.web_searches = body.usage?.server_tool_use?.web_search_requests || 0;
    debug.cache_read_input_tokens = body.usage?.cache_read_input_tokens || 0;
    debug.cache_creation_input_tokens = body.usage?.cache_creation_input_tokens || 0;
    const textBlocks = (body.content || []).filter((b: any) => b.type === 'text');
    const finalText = (textBlocks[textBlocks.length - 1]?.text || '').trim();
    debug.text_preview = finalText.slice(0, 200);
    if (!finalText || /^NONE\b/i.test(finalText)) { debug.rejected_reason = 'NONE_returned'; return { research_text: null, debug }; }
    if (!isValidResearchSignal(finalText, lead.company || '')) { debug.rejected_reason = 'invalid_signal_format'; return { research_text: null, debug }; }
    return { research_text: finalText, debug };
  } catch (e) {
    const err = e as Error; debug.exception = err.message; debug.api_error = true;
    if (err.name === 'TimeoutError' || err.name === 'AbortError') debug.timeout = true;
    return { research_text: null, debug };
  }
}

async function writeOpeningWithGemini(lead: any, cohort: string, researchSignal: string | null): Promise<{ opening: string | null; signal: string | null; used_research: boolean; debug: any }> {
  const decisionType = cohortDecisionType(cohort);
  const firstName = (lead.full_name || '').split(' ')[0] || '';
  const debug: any = { stage: 'gemini_write', model: GEMINI_WRITE_MODEL };
  const prompt = `Write ONE opening sentence (30-55 words) for a cold email from Jon Nugent (ComplianceWorxs, FDA inspection-defense platform).

Recipient: ${lead.full_name} | ${lead.job_title} | ${lead.company}
${lead.linkedin_headline ? `LinkedIn: ${lead.linkedin_headline}` : ''}
${lead.linkedin_description ? `Bio: ${String(lead.linkedin_description).slice(0, 300)}` : ''}
Context: email about authorization records behind ${decisionType}
${researchSignal ? `Research signal: ${researchSignal}` : ''}

Rules: ONE sentence, declarative, ends in period, inspector-authorization frame, peer-to-peer tone, no em-dashes, no ComplianceWorxs mention, no salutation.

Return JSON: {"signal_summary": "...", "opening_sentence": "...", "used_research": bool, "used_linkedin_scope": bool}`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_WRITE_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.7, maxOutputTokens: 2500, thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      }
    );
    debug.status = r.status;
    if (!r.ok) { debug.error = (await r.text()).slice(0, 400); debug.api_error = true; return { opening: null, signal: null, used_research: false, debug }; }
    const body = await r.json();
    debug.finish_reason = body.candidates?.[0]?.finishReason;
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) { debug.empty_response = true; debug.api_error = true; return { opening: null, signal: null, used_research: false, debug }; }
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { debug.parse_error = true; debug.api_error = true; return { opening: null, signal: null, used_research: false, debug }; }
    let sentence = (parsed.opening_sentence || '').trim();
    sentence = sentence.replace(new RegExp(`^${firstName}\\s*[—\\-:]\\s*`, 'i'), '').trim();
    sentence = sentence.replace(/^(Hi|Hello)\s+\w+\s*[,—\-]\s*/i, '').trim();
    if (!sentence || sentence.length < 30 || sentence.length > 600) { debug.invalid_len = sentence.length; debug.api_error = true; return { opening: null, signal: null, used_research: false, debug }; }
    debug.used_linkedin_scope = parsed.used_linkedin_scope === true;
    return { opening: `${firstName} —\n\n${sentence}`, signal: parsed.signal_summary || null, used_research: parsed.used_research === true, debug };
  } catch (e) {
    const err = e as Error; debug.exception = err.message; debug.api_error = true;
    if (err.name === 'TimeoutError' || err.name === 'AbortError') debug.timeout = true;
    return { opening: null, signal: null, used_research: false, debug };
  }
}

function buildEmailBody(opening: string, cohort: string): string {
  const url = CASE_FILE_URLS[cohort] || CASE_FILE_URLS['Batch Release'];
  return `${opening}\n\nA short walkthrough of what that record looks like in the room:\n${url}\n\nWould you want to see what that authorization record looks like when an inspector actually asks?\n\nJon`;
}

function hardFallbackOpening(lead: any, cohort: string): string {
  const first = (lead.full_name || '').split(' ')[0] || '';
  const company = lead.company ? ` at ${lead.company}` : '';
  return `${first} —\n\nWhen an FDA investigator${company} asks who authorized a specific compliance decision — on what evidence, at what moment — the question is whether the record can be produced in the room without reconstruction.`;
}

async function draftOne(supabase: any, lead: any, dryRun: boolean) {
  try {
    const cohort = normalizeCaseFile(lead.case_file_interest);
    const subject = pickSubject(cohort, lead.id);
    const startTime = Date.now();

    const classification = await classifyLead(lead);
    const { domain, method: classifyMethod } = classification;

    const complex = isComplexProfile(lead);
    const template = await getTemplate(supabase, domain, lead.role_function);

    let connectionNote: string;
    let emailBody: string;
    let openingSource: string;
    let modelUsed: string;
    let dmTemplateKey: string | null = null;

    if (template && !complex) {
      // PATH A: TEMPLATE INJECTION
      connectionNote = injectTemplate(template.connection_note, lead);
      const dmBody = injectTemplate(template.dm_body, lead);
      emailBody = buildEmailBody(dmBody, cohort);
      openingSource = 'template_injection';
      modelUsed = 'template_only';
      dmTemplateKey = template.template_key;

    } else if (complex || domain !== 'generic') {
      // PATH B: GEMINI GENERATION
      // FIX 3: Only runs for leads with fit_score >= FIT_SCORE_FLOOR_GEMINI (80)
      // Template path A already ran above for fit 70-79 with template available
      const research = await researchSignal(lead, cohort);

      if (!research.research_text && !research.debug?.api_error) {
        if (!dryRun) {
          await supabase.from('warm_outbound_staging').update({
            first_touch_draft_subject: null, first_touch_draft_body: null,
            first_touch_drafted_at: new Date().toISOString(),
            email_approved: false, email_approved_by: 'v31_silenced',
            outbound_action: 'no_note_connect_only',
            dm_classification_domain: domain, dm_classified_at: new Date().toISOString(),
            dm_model_used: 'silenced',
          }).eq('id', lead.id);
        }
        return { ok: true, action: 'silenced', opening_source: 'silenced_no_signal', path: 'B', domain, classify_method: classifyMethod,
          timings: { total_ms: Date.now() - startTime }, debug: { research: research.debug } };
      }

      const write = await writeOpeningWithGemini(lead, cohort, research.research_text);
      let opening: string;
      if (write.opening) {
        opening = write.opening;
        openingSource = 'gemini_researched';
        modelUsed = 'gemini_flash';
      } else if (research.debug?.api_error || write.debug?.api_error) {
        opening = hardFallbackOpening(lead, cohort);
        openingSource = 'hard_fallback_api_outage';
        modelUsed = 'fallback';
      } else {
        if (!dryRun) {
          await supabase.from('warm_outbound_staging').update({
            first_touch_draft_subject: null, first_touch_draft_body: null,
            first_touch_drafted_at: new Date().toISOString(),
            email_approved: false, outbound_action: 'no_note_connect_only',
            dm_model_used: 'silenced_write_fail',
          }).eq('id', lead.id);
        }
        return { ok: true, action: 'silenced', opening_source: 'silenced_write_failed', path: 'B',
          timings: { total_ms: Date.now() - startTime }, debug: { write: write.debug } };
      }

      if (template) {
        connectionNote = injectTemplate(template.connection_note, lead);
        dmTemplateKey = template.template_key;
      } else {
        connectionNote = opening.split('\n\n')[1] || opening;
      }
      emailBody = buildEmailBody(opening, cohort);

    } else {
      // PATH C: GENERIC TEMPLATE or SILENCE
      if (template) {
        connectionNote = injectTemplate(template.connection_note, lead);
        const dmBody = injectTemplate(template.dm_body, lead);
        emailBody = buildEmailBody(dmBody, cohort);
        openingSource = 'template_generic';
        modelUsed = 'template_only';
        dmTemplateKey = template.template_key;
      } else {
        if (!dryRun) {
          await supabase.from('warm_outbound_staging').update({
            first_touch_draft_subject: null, first_touch_draft_body: null,
            first_touch_drafted_at: new Date().toISOString(),
            email_approved: false, outbound_action: 'no_note_connect_only',
            dm_model_used: 'silenced_no_template',
          }).eq('id', lead.id);
        }
        return { ok: true, action: 'silenced', opening_source: 'silenced_no_template', path: 'C',
          timings: { total_ms: Date.now() - startTime } };
      }
    }

    if (!dryRun) {
      const now = new Date().toISOString();
      await supabase.from('warm_outbound_staging').update({
        first_touch_draft_subject:  subject,
        first_touch_draft_body:     emailBody,
        dm_draft_body:              connectionNote.slice(0, 300),
        first_touch_drafted_at:     now,
        email_approved:             true,
        email_approved_at:          now,
        email_approved_by:          `first_touch_drafter_v31_${openingSource}`,
        outbound_action:            null,
        dm_classification_domain:   domain,
        dm_classified_at:           now,
        dm_model_used:              modelUsed,
        dm_template_key:            dmTemplateKey,
      }).eq('id', lead.id);
    }

    return {
      ok: true, action: 'drafted', path: template && !complex ? 'A' : 'B',
      opening_source: openingSource, model_used: modelUsed,
      domain, classify_method: classifyMethod, template_key: dmTemplateKey,
      subject, dm_preview: connectionNote.slice(0, 120),
      timings: { total_ms: Date.now() - startTime },
    };

  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const url = new URL(req.url);
  const singleId = url.searchParams.get('id');
  const limit = parseInt(url.searchParams.get('limit') || String(BATCH_SIZE_DEFAULT), 10);
  const force = url.searchParams.get('force') === '1';
  const dryRun = url.searchParams.get('dry_run') === '1';

  if (singleId) {
    const { data: lead } = await supabase.from('warm_outbound_staging')
      .select(LEAD_SELECT_COLS).eq('id', parseInt(singleId, 10)).maybeSingle();
    if (!lead) return new Response(JSON.stringify({ error: 'lead_not_found' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const result = await draftOne(supabase, lead, dryRun);
    return new Response(JSON.stringify({ ...result, id: lead.id, name: lead.full_name, dry_run: dryRun }, null, 2),
      { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // FIX 3: Use template floor (70) for batch query — Gemini floor enforced per-lead in draftOne
  // FIX 5: Removed .not('email', 'is', null) — DM path does not require email
  let q = supabase.from('warm_outbound_staging')
    .select(LEAD_SELECT_COLS)
    .eq('is_paying_customer', false)
    .eq('automation_paused', false)
    .not('full_name', 'is', null)
    .gte('fit_score', FIT_SCORE_FLOOR_TEMPLATE)  // FIX 3: was hardcoded 80, now 70
    .is('dispatched_at', null);
  if (!force) q = q.is('first_touch_draft_body', null);
  q = q.order('fit_score', { ascending: false }).limit(limit);

  const { data: leads, error } = await q;
  if (error) return new Response(JSON.stringify({ error: 'fetch_failed', detail: error.message }), { status: 500 });
  if (!leads?.length) return new Response(JSON.stringify({ ok: true, message: 'no leads need drafts', drafted: 0 }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } });

  const paths: Record<string, number> = { A: 0, B: 0, C: 0 };
  const actions: Record<string, number> = { drafted: 0, silenced: 0 };
  let failed = 0;
  const results: any[] = [];

  for (const lead of leads) {
    // FIX 3: Skip Gemini path for leads with fit_score < FIT_SCORE_FLOOR_GEMINI
    // Template path is still available for fit 70-79 (handled inside draftOne)
    const r = await draftOne(supabase, lead, dryRun);
    if (r.ok) {
      paths[r.path as string] = (paths[r.path as string] || 0) + 1;
      actions[r.action as string] = (actions[r.action as string] || 0) + 1;
    } else { failed++; }
    results.push({ id: lead.id, name: lead.full_name, company: lead.company, fit: lead.fit_score,
      ok: r.ok, action: r.action, path: r.path, domain: r.domain, model: r.model_used,
      template: r.template_key, timings: r.timings, error: r.error });
    await new Promise(res => setTimeout(res, BATCH_STAGGER_MS));
  }

  return new Response(JSON.stringify({
    ok: failed === 0, eligible: leads.length, failed, paths, actions, dry_run: dryRun, results,
  }, null, 2), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
