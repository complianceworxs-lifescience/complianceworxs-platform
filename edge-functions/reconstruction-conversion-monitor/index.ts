// reconstruction-conversion-monitor v1 — May 24 2026
// Runs daily. For each visitor who completed /reconstruction and clicked through
// to the case file in the last 7d, checks whether they bought. Writes a row to
// reconstruction_conversion_daily and fires a focused alert if conversion is
// below threshold with enough sample size.
//
// This is the alert pair to the existing posthog-conversion-monitor, but
// scoped specifically to the warmest prospects on the site — people who self-
// identified an inspection-readiness gap and clicked through asking for the fix.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const POSTHOG_HOST = "https://us.posthog.com";
const POSTHOG_PROJECT_ID = "373320";
const POSTHOG_KEY = Deno.env.get("POSTHOG_PERSONAL_API_KEY") || Deno.env.get("POSTHOG_API_KEY") || "";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

async function hogql(q: string) {
  const r = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${POSTHOG_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: q } }),
  });
  if (!r.ok) throw new Error(`PostHog ${r.status}: ${await r.text()}`);
  return (await r.json()).results || [];
}

Deno.serve(async () => {
  if (!POSTHOG_KEY) {
    return new Response(JSON.stringify({ error: "no_posthog_key" }), { status: 500 });
  }
  try {
    // Funnel: completed -> routed -> reached complete-file -> CTA click -> purchase
    const funnel = await hogql(`
      WITH completers AS (
        SELECT distinct_id, min(timestamp) AS completed_at
        FROM events
        WHERE event = 'reconstruction_completed'
          AND timestamp > now() - INTERVAL 7 DAY
        GROUP BY distinct_id
      ),
      routers AS (
        SELECT c.distinct_id, c.completed_at, min(e.timestamp) AS routed_at
        FROM completers c
        INNER JOIN events e ON e.distinct_id = c.distinct_id
        WHERE e.event = 'reconstruction_route_taken'
          AND e.timestamp >= c.completed_at
          AND e.timestamp < c.completed_at + INTERVAL 1 HOUR
        GROUP BY c.distinct_id, c.completed_at
      ),
      reached_buy AS (
        SELECT r.distinct_id, r.routed_at, min(e.timestamp) AS reached_at
        FROM routers r
        INNER JOIN events e ON e.distinct_id = r.distinct_id
        WHERE e.event = '$pageview'
          AND e.properties.$pathname LIKE '%/complete-file%'
          AND e.timestamp >= r.routed_at
          AND e.timestamp < r.routed_at + INTERVAL 1 HOUR
        GROUP BY r.distinct_id, r.routed_at
      ),
      clicked_cta AS (
        SELECT b.distinct_id
        FROM reached_buy b
        INNER JOIN events e ON e.distinct_id = b.distinct_id
        WHERE e.event = 'cta_click'
          AND e.timestamp >= b.reached_at
          AND e.timestamp < b.reached_at + INTERVAL 1 HOUR
        GROUP BY b.distinct_id
      ),
      purchased AS (
        SELECT b.distinct_id
        FROM reached_buy b
        INNER JOIN events e ON e.distinct_id = b.distinct_id
        WHERE e.event = 'purchase'
          AND e.timestamp >= b.reached_at
          AND e.timestamp < b.reached_at + INTERVAL 24 HOUR
        GROUP BY b.distinct_id
      )
      SELECT
        (SELECT count() FROM completers) AS completed,
        (SELECT count() FROM routers) AS routed,
        (SELECT count() FROM reached_buy) AS reached_complete_file,
        (SELECT count() FROM clicked_cta) AS clicked_cta,
        (SELECT count() FROM purchased) AS purchased
    `);

    const row = funnel[0] || [0, 0, 0, 0, 0];
    const completed = Number(row[0]);
    const routed = Number(row[1]);
    const reachedBuy = Number(row[2]);
    const clickedCta = Number(row[3]);
    const purchased = Number(row[4]);

    // Persist daily snapshot
    const { data: inserted } = await supabase.from("reconstruction_conversion_daily").insert({
      window_days: 7,
      completed,
      routed,
      reached_complete_file: reachedBuy,
      clicked_cta: clickedCta,
      purchased,
      route_to_buy_pct: routed > 0 ? Math.round((reachedBuy / routed) * 10000) / 100 : 0,
      buy_to_cta_pct: reachedBuy > 0 ? Math.round((clickedCta / reachedBuy) * 10000) / 100 : 0,
      buy_to_purchase_pct: reachedBuy > 0 ? Math.round((purchased / reachedBuy) * 10000) / 100 : 0,
      end_to_end_pct: completed > 0 ? Math.round((purchased / completed) * 10000) / 100 : 0,
    }).select().single();

    // Alert: reached the buy page, didn't convert, in volume.
    // This is the alert that fires daily until /capa-effectiveness/complete-file is fixed.
    const alerts: any[] = [];
    if (reachedBuy >= 3 && purchased === 0) {
      alerts.push({
        alert_type: "reconstruction_complete_file_bounce",
        severity: "warning",
        source: "reconstruction-conversion-monitor",
        message: `${reachedBuy} reconstruction-completer(s) reached /complete-file in last 7d. ${clickedCta} CTA click(s). ${purchased} purchases. Diagnosis: the buy page is not converting the warmest qualified traffic on the site.`,
        context: { completed, routed, reached_buy: reachedBuy, clicked_cta: clickedCta, purchased },
      });
    }
    if (alerts.length > 0) {
      await supabase.from("system_alerts").insert(alerts);
    }

    return new Response(JSON.stringify({
      ok: true,
      snapshot_id: inserted?.id,
      funnel: { completed, routed, reached_buy: reachedBuy, clicked_cta: clickedCta, purchased },
      alerts_fired: alerts.length,
    }, null, 2), { headers: { "Content-Type": "application/json" }});
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
