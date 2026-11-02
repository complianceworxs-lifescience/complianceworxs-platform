// cw-post-attribution-join v1 — daily post-level LinkedIn attribution (exact utm_campaign + utm_content).
// Called by pg_cron (cw-post-attribution-join-daily) with x-cron-secret, same pattern as posthog-conversion-monitor.
// PostHog is the source of truth. GA4 is not used. No day-level inference: rows without exact tags get
// posthog_join_confidence = insufficient_evidence and NULL numbers.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { EXCLUSION_BASIS, LANDING_QUERY, attributePosts, buildDownstreamQuery, orphanTags, type EventRow, type LandingRow } from "../_shared/post-attribution.ts";

const POSTHOG_HOST = "https://us.posthog.com";
const POSTHOG_PROJECT_ID = "373320";
const KEY = Deno.env.get("POSTHOG_PERSONAL_API_KEY") || Deno.env.get("POSTHOG_API_KEY") || Deno.env.get("POSTHOG_KEY") || "";
const supabase = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");

async function hogql(query: string): Promise<any[][]> {
  const res = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }), signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`PostHog ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).results ?? [];
}
const str = (v: unknown) => (v == null || v === "" ? null : String(v));

async function cronOk(req: Request): Promise<boolean> {
  const { data } = await supabase.from("cw_secrets").select("value").eq("name", "wf-cron-secret").maybeSingle();
  const exp = data?.value as string | undefined, got = req.headers.get("x-cron-secret");
  if (!exp || !got || exp.length !== got.length) return false;
  let d = 0; for (let i = 0; i < exp.length; i++) d |= exp.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req: Request) => {
  if (!(await cronOk(req))) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
  try {
    const { data: posts, error } = await supabase.from("cw_content_performance")
      .select("id,utm_campaign,utm_content,published_at,governed_state,is_controlled_test").not("utm_content", "is", null).not("utm_campaign", "is", null);
    if (error) throw error;
    let landing: LandingRow[] = [], events: EventRow[] = [], queryOk = true, queryErr = "";
    try {
      landing = (await hogql(LANDING_QUERY)).map((r) => ({ utm_campaign: String(r[0]), utm_content: String(r[1]), sid: String(r[2]), distinct_id: String(r[3]),
        journey_id: str(r[4]), test_marked: Number(r[5]), test_identity: Number(r[6]), scanner: Number(r[7]) }));
      const dq = buildDownstreamQuery(landing);
      if (dq) events = (await hogql(dq)).map((r) => ({ sid: String(r[0]), event: String(r[1]), distinct_id: String(r[2]), journey_id: str(r[3]), test_marked: Number(r[4]) }));
    } catch (e) { queryOk = false; queryErr = String(e).slice(0, 300); }

    // server-classified internal journeys (same source posthog-conversion-monitor uses)
    const internal = new Set<string>();
    const [a, b] = await Promise.all([
      supabase.from("cw_dda_summary_request").select("journey_id_hint,blocked_reason,is_test_run").not("journey_id_hint", "is", null),
      supabase.from("cw_dda_report_references").select("journey_id,is_test_run").eq("is_test_run", true)]);
    if (a.error || b.error) { queryOk = false; queryErr ||= "internal-traffic exclusions unavailable"; }
    for (const r of a.data ?? []) if (r.is_test_run || String(r.blocked_reason ?? "").includes("INTERNAL_TRAFFIC")) internal.add(String(r.journey_id_hint));
    for (const r of b.data ?? []) internal.add(String(r.journey_id));

    const results = attributePosts(posts ?? [], landing, events, { now: new Date(), internalJourneys: internal, queryOk });
    const now = new Date().toISOString();
    let written = 0;
    for (const r of results) {
      const patch = { clicks: r.clicks, posthog_sample_views: r.sample_views, posthog_checkout_starts: r.checkout_starts, posthog_purchases: r.purchases,
        posthog_qualified_events: r.qualified_events, posthog_join_method: r.join_method, posthog_join_confidence: r.confidence,
        posthog_join_notes: r.notes, posthog_event_breakdown: { excluded_landing_sessions: r.excluded_landing_sessions, exclusion_basis: EXCLUSION_BASIS },
        posthog_joined_at: now };
      const { error: ue } = await supabase.from("cw_content_performance").update(patch).eq("id", r.id);
      if (ue) throw ue; written++;
    }
    return new Response(JSON.stringify({ ok: queryOk, query_error: queryErr || null, rows_written: written, landing_sessions_seen: landing.length,
      orphan_tags: orphanTags(posts ?? [], landing), exclusion_basis: EXCLUSION_BASIS }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
