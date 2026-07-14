// company-research-anthropic v4
// Processes up to BATCH_SIZE companies per invocation. Cron-driven.
// Detects non-FDA-regulated companies and marks staging rows as disqualified.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BATCH_SIZE = 50;

const RESEARCH_PROMPT = `You are researching a company for an FDA-decision-defensibility outreach campaign. The product (ComplianceWorxs) is for FDA-regulated life sciences companies \u2014 pharma, biotech, medical devices, contract manufacturers (CMOs/CDMOs), and any organization subject to FDA cGMP, 21 CFR Part 11, EU Annex 11, or GAMP 5.

FIRST: Determine if this company is FDA-regulated for life sciences. Building products, retail, oil & gas, IT services, distribution, hospitality, etc. are NOT FDA-regulated for our purposes \u2014 even if they have quality programs.

Research using web search and return a SINGLE JSON object (no markdown, no preamble) with these exact keys:

{
  "is_fda_regulated": boolean,
  "recent_fda_signals": "1-2 sentences. Any 483s, warning letters, EIRs, recalls, consent decrees, or inspection-related news in the last 24 months. If none found, write 'No public FDA enforcement signals found in last 24 months.' If not FDA-regulated, write 'N/A \u2014 not FDA-regulated for life sciences.'",
  "recent_product_events": "1-2 sentences. Recent product launches, FDA approvals/clearances, pipeline milestones, manufacturing expansions, or M&A. Last 12 months only.",
  "leadership_changes": "1 sentence. New VP Quality, Head of Reg Affairs, Chief Compliance Officer, or QA leadership changes in last 12 months. If none, say so.",
  "open_quality_roles": "1 sentence. Any currently posted job openings in QA, validation, regulatory, or compliance that signal expansion or backfill stress. If unknown, say 'Not searched / not found.'",
  "inspector_angle": "1 short sentence. If FDA-regulated: the SHARPEST inspector question this company would face today, framed as 'When FDA asks who authorized [specific decision], what evidence backed it?' \u2014 specific to their situation. If NOT FDA-regulated: write 'DISQUALIFIED \u2014 [one-line reason why this company is outside CW's ICP].'"
}

Return ONLY the JSON object. No code fences, no commentary.`;

interface ResearchResult {
  is_fda_regulated: boolean;
  recent_fda_signals: string;
  recent_product_events: string;
  leadership_changes: string;
  open_quality_roles: string;
  inspector_angle: string;
}

async function researchCompany(companyName: string, domain: string): Promise<{ result?: ResearchResult; raw?: unknown; error?: string }> {
  const userMsg = `Company: ${companyName}\nDomain: ${domain}\n\nResearch this company per the instructions and return the JSON.`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1500,
        system: RESEARCH_PROMPT,
        messages: [{ role: "user", content: userMsg }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { error: `${res.status}: ${txt.slice(0, 300)}` };
    }
    const data = await res.json();
    const textBlocks = (data.content || []).filter((b: any) => b.type === "text");
    const finalText = textBlocks.map((b: any) => b.text).join("\n").trim();
    const cleaned = finalText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    let parsed: ResearchResult;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) return { error: `No JSON found: ${cleaned.slice(0, 300)}`, raw: data };
      parsed = JSON.parse(match[0]);
    }
    return { result: parsed, raw: data };
  } catch (e) {
    return { error: `Exception: ${(e as Error).message}` };
  }
}

function extractDomain(emailOrUrl: string | null): string | null {
  if (!emailOrUrl) return null;
  if (emailOrUrl.includes("@")) return emailOrUrl.split("@")[1].toLowerCase();
  try {
    const u = new URL(emailOrUrl.startsWith("http") ? emailOrUrl : `https://${emailOrUrl}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch { return null; }
}

async function processOne(supabase: any, row: any): Promise<{ ok: boolean; result?: any; error?: string }> {
  const domain = extractDomain(row.email) || extractDomain(row.company_domain);
  if (!domain) {
    await supabase.from("warm_outbound_staging")
      .update({ company_research_status: "error" })
      .eq("id", row.id);
    return { ok: false, error: "no_domain" };
  }

  const { data: existing } = await supabase
    .from("companies_research")
    .select("domain, is_fda_regulated, inspector_angle")
    .eq("domain", domain)
    .maybeSingle();

  if (existing && existing.inspector_angle) {
    const newStatus = existing.is_fda_regulated === false ? "disqualified" : "researched";
    await supabase.from("warm_outbound_staging")
      .update({ company_research_status: newStatus })
      .eq("id", row.id);
    return { ok: true, result: { cached: true, id: row.id, domain, status: newStatus } };
  }

  const { result, raw, error: err } = await researchCompany(row.company || domain, domain);

  if (err || !result) {
    await supabase.from("companies_research").upsert({
      domain, company_name: row.company || domain,
      research_error: err, raw_response: raw as any,
    });
    await supabase.from("warm_outbound_staging")
      .update({ company_research_status: "error" })
      .eq("id", row.id);
    return { ok: false, error: err };
  }

  await supabase.from("companies_research").upsert({
    domain,
    company_name: row.company || domain,
    is_fda_regulated: result.is_fda_regulated,
    recent_fda_signals: result.recent_fda_signals,
    recent_product_events: result.recent_product_events,
    leadership_changes: result.leadership_changes,
    open_quality_roles: result.open_quality_roles,
    inspector_angle: result.inspector_angle,
    raw_response: raw as any,
    research_error: null,
    researched_at: new Date().toISOString(),
  });

  const newStatus = result.is_fda_regulated === false ? "disqualified" : "researched";
  await supabase.from("warm_outbound_staging")
    .update({ company_research_status: newStatus })
    .eq("id", row.id);

  return {
    ok: true,
    result: {
      id: row.id, domain,
      company: row.company,
      status: newStatus,
      is_fda_regulated: result.is_fda_regulated,
      inspector_angle: result.inspector_angle,
    }
  };
}

serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: rows } = await supabase
    .from("warm_outbound_staging")
    .select("id, full_name, email, company, company_domain")
    .eq("company_research_status", "pending")
    .not("email", "is", null)
    .order("id", { ascending: true })
    .limit(BATCH_SIZE);

  if (!rows || rows.length === 0) {
    return new Response(JSON.stringify({ message: "No pending rows", processed: 0 }), { status: 200 });
  }

  const results = [];
  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    const r = await processOne(supabase, row);
    results.push(r);
    if (r.ok) succeeded++; else failed++;
  }

  return new Response(JSON.stringify({
    processed: rows.length,
    succeeded,
    failed,
    results,
  }, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
});
