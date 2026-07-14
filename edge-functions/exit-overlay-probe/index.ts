// exit-overlay-probe — one-shot. What kind of exit overlay is firing on /complete-file?
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const POSTHOG_HOST = "https://us.posthog.com";
const POSTHOG_PROJECT_ID = "373320";
const POSTHOG_KEY = Deno.env.get("POSTHOG_PERSONAL_API_KEY") || Deno.env.get("POSTHOG_API_KEY") || "";

async function hogql(q: string) {
  const r = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${POSTHOG_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: q } })
  });
  if (!r.ok) throw new Error(`PostHog ${r.status}: ${await r.text()}`);
  return (await r.json()).results || [];
}

Deno.serve(async () => {
  try {
    const out: Record<string, any> = {};

    // exit_intent and exit_overlay_* events on /complete-file pages, last 14 days, with all properties
    out.exit_intent_props = await hogql(`
      SELECT properties.$pathname AS path,
             properties.overlay_type AS overlay_type,
             properties.variant AS variant,
             properties.trigger AS trigger,
             count() AS n
      FROM events
      WHERE event = 'exit_intent'
        AND properties.$pathname LIKE '%/complete-file%'
        AND timestamp > now() - INTERVAL 14 DAY
      GROUP BY path, overlay_type, variant, trigger
      ORDER BY n DESC
    `);

    out.exit_overlay_dismissed_props = await hogql(`
      SELECT properties.$pathname AS path,
             properties.overlay_type AS overlay_type,
             properties.variant AS variant,
             count() AS n
      FROM events
      WHERE event = 'exit_overlay_dismissed'
        AND timestamp > now() - INTERVAL 14 DAY
      GROUP BY path, overlay_type, variant
      ORDER BY n DESC
    `);

    // Full event vocabulary on /complete-file pages — what events fire at all?
    out.all_events_on_complete_file = await hogql(`
      SELECT event, count() AS n
      FROM events
      WHERE properties.$pathname LIKE '%/complete-file%'
        AND timestamp > now() - INTERVAL 14 DAY
      GROUP BY event ORDER BY n DESC
    `);

    // Median dwell time on /complete-file before exit, by visitor
    out.dwell_distribution = await hogql(`
      WITH pages AS (
        SELECT distinct_id, properties.$pathname AS path, min(timestamp) AS enter, max(timestamp) AS leave
        FROM events
        WHERE properties.$pathname = '/capa-effectiveness/complete-file'
          AND timestamp > now() - INTERVAL 14 DAY
          AND event IN ('$pageview', '$pageleave', 'exit_intent', 'scroll_threshold')
        GROUP BY distinct_id, path
      )
      SELECT count() AS visitors,
             round(avg(dateDiff('second', enter, leave))) AS avg_seconds,
             round(quantile(0.5)(dateDiff('second', enter, leave))) AS median_seconds,
             round(quantile(0.9)(dateDiff('second', enter, leave))) AS p90_seconds
      FROM pages
    `);

    // How many unique visitors on /complete-file in 14d, and how many had ANY conversion event
    out.complete_file_conversion = await hogql(`
      SELECT
        uniq(distinct_id) FILTER (WHERE event = '$pageview') AS visitors,
        uniq(distinct_id) FILTER (WHERE event = 'lock_view') AS hit_lock,
        uniq(distinct_id) FILTER (WHERE event = 'email_gate_shown') AS gate_shown,
        uniq(distinct_id) FILTER (WHERE event = 'email_gate_submitted') AS captured,
        uniq(distinct_id) FILTER (WHERE event = 'cta_click') AS clicked_cta,
        uniq(distinct_id) FILTER (WHERE event = 'purchase') AS purchased
      FROM events
      WHERE properties.$pathname = '/capa-effectiveness/complete-file'
        AND timestamp > now() - INTERVAL 14 DAY
    `);

    return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" }});
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
