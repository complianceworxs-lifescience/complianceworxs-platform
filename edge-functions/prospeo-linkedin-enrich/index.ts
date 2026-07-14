// prospeo-linkedin-enrich v13 — May 17 2026
// V13 CHANGE: Detects unique-constraint violations on (lower(email)) and routes the duplicate
// row to enrichment_status='duplicate_skipped' instead of silently failing forever.
//
// Background: v11 swallowed update errors. The Prospeo-returned email sometimes matches a row
// that already exists in warm_outbound_staging (e.g. PB CSV re-import of a lead already in the
// system). The uniq_warm_staging_email constraint blocks the update, but the function would
// report enriched++ and the row stayed in 'pending' forever, getting reprocessed every 15 min.
//
// V13 also adds an explicit failure path for any other unexpected update error, so they can
// no longer be silent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROSPEO_KEY = Deno.env.get("PROSPEO_API_KEY") ?? "";
const ATTIO_API_KEY = Deno.env.get("ATTIO_API_KEY")!;
const PB_SECRET = Deno.env.get("PHANTOMBUSTER_WEBHOOK_SECRET") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const RETRY_STATUSES = [
  "pending",
  "failed_hunter_no_profile",
  "failed_hunter_error",
  "failed_hunter_rate_limit",
  "failed_hunter_no_match",
  "failed_hunter_credits_exhausted",
  "failed_hunter_auth",
  "failed_hunter_bad_request",
  "failed_invalid_linkedin",
  "failed_unverified_email",
  "failed_no_email",
];

function normalizeLinkedInUrl(raw: string): string {
  let url = raw.trim().split("?")[0].replace(/\/+$/, "");
  if (!url.startsWith("http")) url = `https://${url}`;
  url = url.replace(/^https?:\/\/(?:www\.)?linkedin\.com/i, "https://www.linkedin.com");
  return url;
}

async function enrichPerson(linkedinUrl: string): Promise<{
  ok: boolean;
  email?: string;
  email_status?: string;
  company_name?: string;
  company_domain?: string;
  job_title?: string;
  free_enrichment?: boolean;
  error?: string;
  rate_limit_minute_left?: number;
  rate_limit_daily_left?: number;
  status_code?: number;
}> {
  if (!PROSPEO_KEY) return { ok: false, error: "no_prospeo_key" };
  const url = normalizeLinkedInUrl(linkedinUrl);

  try {
    const res = await fetch("https://api.prospeo.io/enrich-person", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-KEY": PROSPEO_KEY },
      body: JSON.stringify({ only_verified_email: true, data: { linkedin_url: url } }),
    });

    const minLeft = parseInt(res.headers.get("x-minute-request-left") || "", 10);
    const dayLeft = parseInt(res.headers.get("x-daily-request-left") || "", 10);
    const text = await res.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch {}

    const baseRet = {
      rate_limit_minute_left: isNaN(minLeft) ? undefined : minLeft,
      rate_limit_daily_left: isNaN(dayLeft) ? undefined : dayLeft,
      status_code: res.status,
    };

    if (!res.ok || data.error) {
      const code = data?.error_code || "unknown";
      return { ok: false, error: `prospeo_${res.status}_${code}`, ...baseRet };
    }

    const email = data?.person?.email?.email;
    const status = data?.person?.email?.status;
    if (!email) return { ok: false, error: "no_email_in_response", ...baseRet };
    if (status !== "VERIFIED") return { ok: false, error: `email_status_${status || "missing"}`, ...baseRet };

    return {
      ok: true,
      email,
      email_status: status,
      company_name: data?.company?.name || null,
      company_domain: data?.company?.domain || null,
      job_title: data?.person?.current_job_title || null,
      free_enrichment: data?.free_enrichment === true,
      ...baseRet,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function syncEmailToAttio(recordId: string, email: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.attio.com/v2/objects/people/records/${recordId}`, {
      method: "PATCH",
      headers: { "Authorization": `Bearer ${ATTIO_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ data: { values: { email_addresses: [email] } } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function batchEnrich(supabase: any, limit: number) {
  const { data: pending, error } = await supabase
    .from("warm_outbound_staging")
    .select("id, full_name, first_name, last_name, linkedin_url, attio_record_id, job_title")
    .in("enrichment_status", RETRY_STATUSES)
    .eq("automation_paused", false)
    .is("email", null)
    .not("linkedin_url", "is", null)
    .order("id", { ascending: false })
    .limit(limit);

  if (error) return { processed: 0, enriched: 0, failed: 0, query_error: error.message };
  if (!pending?.length) return { processed: 0, enriched: 0, failed: 0, message: "no pending" };

  let enriched = 0;
  let failed = 0;
  let duplicates = 0;
  let updateErrors = 0;
  let synced = 0;
  let freeCount = 0;
  let lastMinLeft: number | undefined;
  let lastDayLeft: number | undefined;
  let earlyExit = false;
  const errors: string[] = [];

  for (let i = 0; i < pending.length; i++) {
    const lead = pending[i];
    const result = await enrichPerson(lead.linkedin_url);

    if (typeof result.rate_limit_minute_left === "number") lastMinLeft = result.rate_limit_minute_left;
    if (typeof result.rate_limit_daily_left === "number") lastDayLeft = result.rate_limit_daily_left;

    if (result.status_code === 429) {
      earlyExit = true;
      break;
    }

    if (result.ok && result.email) {
      if (result.free_enrichment) freeCount++;

      // Attempt the enrichment write, capture any error
      const updRes = await supabase.from("warm_outbound_staging").update({
        email: result.email,
        company: result.company_name || null,
        company_domain: result.company_domain || null,
        job_title: result.job_title || lead.job_title || null,
        enrichment_status: "enriched",
        domain_resolution_method: "prospeo_enrich_person",
        enriched_at: new Date().toISOString(),
        domain_resolved_at: new Date().toISOString(),
      }).eq("id", lead.id).select("id");

      if (updRes.error) {
        // PG error 23505 = unique_violation. We know it's the email constraint.
        const isUniqueViolation = updRes.error.code === "23505";
        const newStatus = isUniqueViolation ? "duplicate_skipped" : "failed_update_error";
        const reason = isUniqueViolation
          ? `email ${result.email} already exists on another staging row`
          : `update_error: ${updRes.error.code} ${updRes.error.message}`.slice(0, 400);

        await supabase.from("warm_outbound_staging").update({
          enrichment_status: newStatus,
          enriched_at: new Date().toISOString(),
          automation_paused: true,
          automation_paused_reason: reason,
          domain_resolution_method: "prospeo_enrich_person",
          push_error: reason,
        }).eq("id", lead.id);

        if (isUniqueViolation) {
          duplicates++;
        } else {
          updateErrors++;
          if (errors.length < 5) errors.push(`row ${lead.id}: update_error ${updRes.error.code}`);
        }
        continue;
      }

      enriched++;

      if (lead.attio_record_id) {
        const ok = await syncEmailToAttio(lead.attio_record_id, result.email);
        if (ok) synced++;
      }
    } else {
      let status = "failed_prospeo_error";
      if (result.error?.includes("NO_MATCH")) status = "failed_no_match";
      else if (result.error?.includes("INVALID_DATAPOINTS")) status = "failed_invalid_input";
      else if (result.error?.includes("INSUFFICIENT_CREDITS")) status = "failed_insufficient_credits";
      else if (result.error?.startsWith("email_status_")) status = "failed_unverified_email";
      else if (result.error === "no_email_in_response") status = "failed_no_email";

      await supabase.from("warm_outbound_staging").update({
        enrichment_status: status,
        domain_resolution_method: "prospeo_enrich_person",
        enriched_at: new Date().toISOString(),
      }).eq("id", lead.id);
      failed++;
      if (errors.length < 5) errors.push(`row ${lead.id}: ${result.error}`);
    }

    if (i < pending.length - 1) {
      if (typeof lastMinLeft === "number" && lastMinLeft <= 1) {
        earlyExit = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  return {
    processed: pending.length,
    enriched,
    failed,
    duplicates,
    update_errors: updateErrors,
    synced_to_attio: synced,
    free_enrichments: freeCount,
    early_exit_rate_limited: earlyExit,
    rate_limit_minute_left: lastMinLeft,
    rate_limit_daily_left: lastDayLeft,
    errors,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const secret = url.searchParams.get("secret") || "";
  if (!PB_SECRET || secret !== PB_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  if (!PROSPEO_KEY) {
    return new Response(JSON.stringify({ error: "PROSPEO_API_KEY not set" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const limit = parseInt(url.searchParams.get("limit") || "10", 10);
  const result = await batchEnrich(supabase, limit);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
