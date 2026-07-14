// lead-fit-scorer v6 — May 17 2026
// V6 CHANGE: scores DM-track leads (enrichment_status = 'pending_linkedin_dm' or 'enriched')
// even when they don't have an email. LLM classifier doesn't need email — name/title/company is enough.
//
// Why: 160+ DM-track leads were sitting unscored because v5 required both 'enriched' status
// AND non-null email. That hid the highest-fit DM-track leads (e.g. Evelyn Marchany García at
// BioMarin, SVP CQO) from the operator's queue.
//
// v5 single-row mode is preserved — it still triggers from the Postgres trigger when a new
// row arrives. v6 just extends the batch filter to cover the DM track.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Statuses eligible for fit scoring. DM-track leads ('pending_linkedin_dm') are first-class
// candidates because the classifier only needs name/title/company, not email.
const SCOREABLE_STATUSES = ['enriched', 'pending_linkedin_dm'];

const INDUSTRY_WEIGHTS: Record<string, number> = {
  pharma: 40, biotech: 35, food_beverage: 32, cosmetics: 30, cdmo: 30, med_device: 30, non_target: 0,
};
const SENIORITY_WEIGHTS: Record<string, number> = {
  executive: 25, director: 20, manager: 15, individual: 5,
};
const FUNCTION_WEIGHTS: Record<string, number> = {
  qa: 20, regulatory: 18, validation: 18, manufacturing: 10, other: 2,
};

function buildPrompt(lead: any): string {
  return `You are classifying a sales lead for ComplianceWorxs (CW), a decision defensibility platform for FDA-regulated companies. CW sells to Quality Assurance, Regulatory Affairs, and Validation leaders across the full FDA Compliance DNA: pharma, biotech, medical device, CDMOs, food and beverage manufacturers, and cosmetics/personal care brands.

Classify this lead. Return ONLY a JSON object, no prose, no code fences.

Lead:
- Name: ${lead.full_name || '(unknown)'}
- Job title: ${lead.job_title || '(unknown)'}
- Company: ${lead.company || '(unknown)'}
- Company domain: ${lead.company_domain || '(unknown)'}
- Email: ${lead.email || '(unknown)'}

Return this exact shape:

{
  "industry": one of ["pharma", "biotech", "med_device", "cdmo", "food_beverage", "cosmetics", "non_target"],
  "industry_confidence": number 0.0 to 1.0,
  "industry_reason": one short sentence,
  "role_seniority": one of ["executive", "director", "manager", "individual"],
  "role_function": one of ["qa", "regulatory", "validation", "manufacturing", "other"]
}

Industry rules:
- pharma: drug manufacturer or developer (small molecule, generics, branded).
- biotech: biologics, gene therapy, cell therapy, oncology biotech, clinical-stage.
- med_device: medical devices, IVDs, surgical instruments.
- cdmo: contract development/manufacturing for pharma.
- food_beverage: FDA-regulated food, beverage, dietary supplement under FSMA / 21 CFR 117 / 111 / HACCP.
- cosmetics: cosmetics, personal care, topical OTC under FDA cosmetics rules and MoCRA.
- non_target: anything outside FDA-regulated industries above.

Role seniority: executive (VP/SVP/C-suite/Head of), director (Director/Sr Director), manager (Manager/Lead/Principal), individual (Engineer/Specialist/Analyst).
Role function: qa (Quality), regulatory (RA/Compliance), validation (CSV/CSA/V&V), manufacturing (Production/Operations/Plant), other.

Return the JSON now.`;
}

async function classify(lead: any): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: buildPrompt(lead) }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: `claude_${r.status}_${text.slice(0,200)}` };
    const body = JSON.parse(text);
    const content = body?.content?.[0]?.text || '';
    const cleaned = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim();
    let parsed: any;
    try { parsed = JSON.parse(cleaned); }
    catch (e) { return { ok: false, error: `parse_failed: ${cleaned.slice(0, 200)}` }; }
    return { ok: true, data: parsed };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function computeFitScore(
  industry: string, seniority: string, fn: string,
  enrichedAt: string | null, hasDomain: boolean
): { score: number; breakdown: any } {
  const industryPoints = INDUSTRY_WEIGHTS[industry] ?? 0;
  const seniorityPoints = SENIORITY_WEIGHTS[seniority] ?? 0;
  const functionPoints = FUNCTION_WEIGHTS[fn] ?? 0;
  let recencyPoints = 0;
  if (enrichedAt) {
    const days = (Date.now() - new Date(enrichedAt).getTime()) / 86400000;
    if (days < 7) recencyPoints = 10;
    else if (days < 30) recencyPoints = 5;
  }
  const domainPoints = hasDomain ? 5 : 0;
  const score = Math.min(100, industryPoints + seniorityPoints + functionPoints + recencyPoints + domainPoints);
  return {
    score,
    breakdown: { industry: industryPoints, seniority: seniorityPoints, function: functionPoints, recency: recencyPoints, domain: domainPoints, total: score },
  };
}

async function processLead(supabase: any, lead: any): Promise<{ ok: boolean; score?: number; industry?: string; error?: string }> {
  const result = await classify(lead);
  if (!result.ok || !result.data) return { ok: false, error: result.error };

  const c = result.data;
  const validIndustries = ['pharma','biotech','med_device','cdmo','food_beverage','cosmetics','non_target'];
  const industry = validIndustries.includes(c.industry) ? c.industry : 'non_target';
  const seniority = ['executive','director','manager','individual'].includes(c.role_seniority) ? c.role_seniority : 'individual';
  const fn = ['qa','regulatory','validation','manufacturing','other'].includes(c.role_function) ? c.role_function : 'other';
  const { score, breakdown } = computeFitScore(industry, seniority, fn, lead.enriched_at, !!lead.company_domain);

  const update: any = {
    industry,
    industry_confidence: typeof c.industry_confidence === 'number' ? c.industry_confidence : null,
    role_seniority: seniority, role_function: fn,
    fit_score: score, fit_score_breakdown: breakdown,
    fit_scored_at: new Date().toISOString(),
  };
  // Only flip status to disqualified for fully-enriched email leads. DM-track leads keep their status.
  if (industry === 'non_target' && lead.enrichment_status === 'enriched') {
    update.enrichment_status = 'disqualified_non_target';
  } else if (industry !== 'non_target' && lead.enrichment_status === 'disqualified_non_target') {
    update.enrichment_status = 'enriched';
  }

  await supabase.from('warm_outbound_staging').update(update).eq('id', lead.id);
  return { ok: true, score, industry };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Single-row mode — invoked by Postgres trigger
  const singleId = url.searchParams.get('id');
  if (singleId) {
    const { data: lead, error } = await supabase
      .from('warm_outbound_staging')
      .select('id, full_name, email, job_title, company, company_domain, enriched_at, enrichment_status, automation_paused, is_paying_customer, fit_score')
      .eq('id', parseInt(singleId, 10))
      .maybeSingle();
    if (error || !lead) {
      return new Response(JSON.stringify({ error: 'lead_not_found', id: singleId }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    if (lead.automation_paused || lead.is_paying_customer) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'paused_or_customer' }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    if (lead.fit_score !== null) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'already_scored', score: lead.fit_score }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    // v6: DM-track leads are eligible without email. Email-track leads still need enrichment first.
    const isScoreable = SCOREABLE_STATUSES.includes(lead.enrichment_status);
    if (!isScoreable) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'not_in_scoreable_status', status: lead.enrichment_status }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    // Need at least name + (title or company) to classify usefully
    if (!lead.full_name || (!lead.job_title && !lead.company)) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'insufficient_data_for_classification' }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const result = await processLead(supabase, lead);
    return new Response(JSON.stringify({ ...result, mode: 'single', id: lead.id }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Batch mode
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const force = url.searchParams.get('force') === '1';
  const rescoreDisqualified = url.searchParams.get('rescore_disqualified') === '1';

  let q = supabase.from('warm_outbound_staging')
    .select('id, full_name, email, job_title, company, company_domain, enriched_at, enrichment_status')
    .eq('automation_paused', false).eq('is_paying_customer', false);

  if (rescoreDisqualified) {
    q = q.eq('enrichment_status', 'disqualified_non_target');
  } else {
    // v6: include both 'enriched' and 'pending_linkedin_dm'. Email no longer required.
    q = q.in('enrichment_status', SCOREABLE_STATUSES).not('full_name', 'is', null);
    if (!force) q = q.is('fit_score', null);
  }
  // Score DM-track leads first (they've been waiting), then enriched email leads
  q = q.order('id', { ascending: false }).limit(limit);

  const { data: leads, error } = await q;
  if (error) return new Response(JSON.stringify({ error: 'fetch_failed', detail: error.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (!leads?.length) return new Response(JSON.stringify({ ok: true, message: 'no leads to score', scored: 0 }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  let scored = 0, failed = 0, skipped_low_data = 0;
  const errors: string[] = [];
  for (const lead of leads) {
    // Skip rows missing both title and company — classifier can't infer industry from name alone
    if (!lead.job_title && !lead.company) { skipped_low_data++; continue; }
    const result = await processLead(supabase, lead);
    if (result.ok) scored++; else { failed++; if (errors.length < 5) errors.push(`row ${lead.id}: ${result.error?.slice(0, 150)}`); }
    await new Promise(r => setTimeout(r, 250));
  }
  return new Response(JSON.stringify({ ok: failed === 0, processed: leads.length, scored, failed, skipped_low_data, errors }, null, 2), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
