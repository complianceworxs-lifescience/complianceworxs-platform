// supabase/functions/job-scraper/index.ts
// v2: Multi-ATS discovery (Greenhouse, Lever, Ashby, SmartRecruiters) +
//     USAJobs API. Pulls company list from target_accounts table.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const USAJOBS_API_KEY = Deno.env.get("USAJOBS_API_KEY") || "";
const USAJOBS_EMAIL = Deno.env.get("USAJOBS_EMAIL") || "jon@complianceworxs.com";
const VERCEL_DEPLOY_HOOK = Deno.env.get("VERCEL_TIR_DEPLOY_HOOK") || "";
const FUNCTION_SECRET = Deno.env.get("JOB_SCRAPER_SECRET") || "";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

const TITLE_INCLUDE = [
  "quality assurance", "quality control", "qa ", " qa,", "qa/", "qc ",
  "regulatory affairs", "regulatory compliance",
  "validation", "csv", "csa",
  "gmp", "gxp", "good manufacturing",
  "compliance", "auditor", "audit ",
  "inspection", "capa",
  "batch release", "process validation",
  "quality engineer", "quality systems",
  "head of quality", "vp quality", "director quality", "manager quality",
];

const TITLE_EXCLUDE = [
  "software quality", "test engineer", "qa engineer software",
  "sdet", "sales", "marketing", "recruiter",
  "data quality", "data analyst", "data engineer",
  "intern", "student", "co-op", "coop",
];

function matchesCompliance(title: string): { match: boolean; keyword?: string } {
  const t = (title || "").toLowerCase();
  if (!t) return { match: false };
  for (const ex of TITLE_EXCLUDE) if (t.includes(ex)) return { match: false };
  for (const inc of TITLE_INCLUDE) if (t.includes(inc)) return { match: true, keyword: inc.trim() };
  return { match: false };
}

function categorize(title: string): string {
  const t = (title || "").toLowerCase();
  if (t.includes("regulatory")) return "Regulatory Affairs";
  if (t.includes("validation") || t.includes("csv") || t.includes("csa")) return "Validation";
  if (t.includes("audit")) return "Audit";
  if (t.includes("compliance")) return "Compliance";
  if (t.includes("capa")) return "CAPA";
  return "QA";
}

function inferWorkStyle(location: string): string {
  const l = (location || "").toLowerCase();
  if (l.includes("remote")) return "Remote";
  if (l.includes("hybrid")) return "Hybrid";
  return "On-Site";
}

function slugifyCompanyName(name: string): string[] {
  const cleaned = name
    .toLowerCase()
    .replace(/\binc\.?\b|\bcorp\.?\b|\bllc\b|\bltd\.?\b|\bcompany\b|\bcompanies\b|\bplc\b|\b&\b|\bof\b/gi, "")
    .replace(/[.,]/g, "")
    .trim();
  const variants = new Set<string>();
  variants.add(cleaned.replace(/\s+/g, ""));
  variants.add(cleaned.replace(/\s+/g, "-"));
  const first = cleaned.split(/\s+/)[0];
  if (first && first.length >= 4) variants.add(first);
  return Array.from(variants);
}

interface ScrapedJob {
  external_id: string; source: string; source_company_slug: string;
  title: string; company_name: string; location: string;
  work_style: string; category: string; apply_url: string; matched_keyword: string;
}

async function tryGreenhouse(companyName: string, slug: string): Promise<ScrapedJob[]> {
  try {
    const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, {
      headers: { "User-Agent": "TIR-aggregator" }
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.jobs || []).flatMap((j: any) => {
      const m = matchesCompliance(j.title);
      if (!m.match) return [];
      return [{
        external_id: `greenhouse:${slug}:${j.id}`, source: "greenhouse", source_company_slug: slug,
        title: j.title, company_name: companyName, location: j.location?.name || "",
        work_style: inferWorkStyle(j.location?.name || ""), category: categorize(j.title),
        apply_url: j.absolute_url, matched_keyword: m.keyword || "",
      }];
    });
  } catch { return []; }
}

async function tryLever(companyName: string, slug: string): Promise<ScrapedJob[]> {
  try {
    const r = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`, {
      headers: { "User-Agent": "TIR-aggregator" }
    });
    if (!r.ok) return [];
    const jobs = await r.json();
    if (!Array.isArray(jobs)) return [];
    return jobs.flatMap((j: any) => {
      const m = matchesCompliance(j.text);
      if (!m.match) return [];
      return [{
        external_id: `lever:${slug}:${j.id}`, source: "lever", source_company_slug: slug,
        title: j.text, company_name: companyName, location: j.categories?.location || "",
        work_style: inferWorkStyle(j.categories?.location || ""), category: categorize(j.text),
        apply_url: j.hostedUrl || j.applyUrl, matched_keyword: m.keyword || "",
      }];
    });
  } catch { return []; }
}

async function tryAshby(companyName: string, slug: string): Promise<ScrapedJob[]> {
  try {
    const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, {
      headers: { "User-Agent": "TIR-aggregator" }
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.jobs || []).flatMap((j: any) => {
      const m = matchesCompliance(j.title);
      if (!m.match) return [];
      return [{
        external_id: `ashby:${slug}:${j.id}`, source: "ashby", source_company_slug: slug,
        title: j.title, company_name: companyName, location: j.location || "",
        work_style: inferWorkStyle(j.location || ""), category: categorize(j.title),
        apply_url: j.jobUrl || `https://jobs.ashbyhq.com/${slug}/${j.id}`,
        matched_keyword: m.keyword || "",
      }];
    });
  } catch { return []; }
}

async function trySmartRecruiters(companyName: string, slug: string): Promise<ScrapedJob[]> {
  try {
    const r = await fetch(`https://api.smartrecruiters.com/v1/companies/${slug}/postings`, {
      headers: { "User-Agent": "TIR-aggregator" }
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.content || []).flatMap((j: any) => {
      const m = matchesCompliance(j.name);
      if (!m.match) return [];
      const loc = j.location ? `${j.location.city || ""}${j.location.region ? ", " + j.location.region : ""}`.trim() : "";
      return [{
        external_id: `smartrecruiters:${slug}:${j.id}`, source: "smartrecruiters", source_company_slug: slug,
        title: j.name, company_name: companyName, location: loc, work_style: inferWorkStyle(loc),
        category: categorize(j.name), apply_url: j.ref || `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
        matched_keyword: m.keyword || "",
      }];
    });
  } catch { return []; }
}

async function discoverAndScrape(companyName: string): Promise<{ jobs: ScrapedJob[]; provider?: string; slug?: string }> {
  const slugs = slugifyCompanyName(companyName);
  const fetchers: Array<[string, (n: string, s: string) => Promise<ScrapedJob[]>]> = [
    ["greenhouse", tryGreenhouse],
    ["lever", tryLever],
    ["ashby", tryAshby],
    ["smartrecruiters", trySmartRecruiters],
  ];
  for (const slug of slugs) {
    for (const [provider, fn] of fetchers) {
      const jobs = await fn(companyName, slug);
      if (jobs.length > 0) return { jobs, provider, slug };
    }
  }
  return { jobs: [] };
}

async function scrapeUSAJobs(): Promise<ScrapedJob[]> {
  if (!USAJOBS_API_KEY) return [];
  const keywords = ["FDA Quality", "FDA Compliance", "Regulatory Affairs", "GMP", "Validation Engineer"];
  const results: ScrapedJob[] = [];
  for (const kw of keywords) {
    try {
      const r = await fetch(`https://data.usajobs.gov/api/search?Keyword=${encodeURIComponent(kw)}&ResultsPerPage=25`, {
        headers: {
          "Authorization-Key": USAJOBS_API_KEY,
          "User-Agent": USAJOBS_EMAIL,
          "Host": "data.usajobs.gov",
        },
      });
      if (!r.ok) continue;
      const data = await r.json();
      const items = data.SearchResult?.SearchResultItems || [];
      for (const it of items) {
        const job = it.MatchedObjectDescriptor;
        const m = matchesCompliance(job.PositionTitle);
        if (!m.match) continue;
        const location = job.PositionLocationDisplay || job.PositionLocation?.[0]?.LocationName || "";
        results.push({
          external_id: `usajobs:${it.MatchedObjectId}`, source: "usajobs", source_company_slug: "federal",
          title: job.PositionTitle, company_name: job.OrganizationName || "U.S. Federal Government",
          location, work_style: inferWorkStyle(location), category: categorize(job.PositionTitle),
          apply_url: job.PositionURI, matched_keyword: m.keyword || "",
        });
      }
    } catch { /* skip */ }
  }
  return results;
}

async function upsertJobs(jobs: ScrapedJob[]) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
  let inserted = 0, updated = 0, errors = 0;
  for (const job of jobs) {
    const { data: existing } = await sb.from("job_postings").select("id").eq("external_id", job.external_id).maybeSingle();
    if (existing) {
      const { error } = await sb.from("job_postings").update({
        last_seen_at: now, is_active: true, title: job.title, location: job.location, updated_at: now,
      }).eq("id", existing.id);
      error ? errors++ : updated++;
    } else {
      const { error } = await sb.from("job_postings").insert({
        external_id: job.external_id, source: job.source, source_company_slug: job.source_company_slug,
        title: job.title, company_name: job.company_name, location: job.location, work_style: job.work_style,
        employment_type: "Full-Time", category: job.category, apply_url: job.apply_url,
        tier: "community", is_paid: false, published_at: now, expires_at: expiresAt,
        last_seen_at: now, is_active: true, matched_keyword: job.matched_keyword,
      });
      error ? errors++ : inserted++;
    }
  }
  return { inserted, updated, errors };
}

async function deactivateStale(): Promise<number> {
  const cutoff = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data } = await sb.from("job_postings").update({
    is_active: false, updated_at: new Date().toISOString(),
  }).lt("last_seen_at", cutoff).eq("is_active", true).eq("is_paid", false).select("id");
  return data?.length || 0;
}

async function triggerVercelRebuild(): Promise<boolean> {
  if (!VERCEL_DEPLOY_HOOK) return false;
  try { const r = await fetch(VERCEL_DEPLOY_HOOK, { method: "POST" }); return r.ok; }
  catch { return false; }
}

serve(async (req) => {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (FUNCTION_SECRET && secret !== FUNCTION_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  const dryRun = url.searchParams.get("dry_run") === "1";
  const limitCompanies = parseInt(url.searchParams.get("limit") || "60");

  const { data: accounts } = await sb.from("target_accounts")
    .select("company_name, website")
    .eq("active", true)
    .order("priority_score", { ascending: false, nullsFirst: false })
    .limit(limitCompanies);

  const allJobs: ScrapedJob[] = [];
  const discoveryLog: Record<string, string> = {};

  for (const acct of accounts || []) {
    const { jobs, provider, slug } = await discoverAndScrape(acct.company_name);
    allJobs.push(...jobs);
    discoveryLog[acct.company_name] = jobs.length > 0 ? `${provider}:${slug}:${jobs.length}` : "no_match";
  }

  const fedJobs = await scrapeUSAJobs();
  allJobs.push(...fedJobs);
  discoveryLog["__usajobs__"] = `${fedJobs.length}`;

  if (dryRun) {
    return new Response(JSON.stringify({
      dry_run: true, total_matched: allJobs.length, discovery: discoveryLog,
      sample: allJobs.slice(0, 10),
    }, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  const upsertResult = await upsertJobs(allJobs);
  const deactivated = await deactivateStale();
  const rebuilt = await triggerVercelRebuild();

  return new Response(JSON.stringify({
    total_matched: allJobs.length, upsert: upsertResult,
    deactivated_stale: deactivated, vercel_rebuild_triggered: rebuilt,
    discovery: discoveryLog, timestamp: new Date().toISOString(),
  }, null, 2), { headers: { "Content-Type": "application/json" } });
});