// reconstruction-funnel-probe — one-shot. Pulls 30d of reconstruction_* events from PostHog
// to determine real conversion through the /reconstruction diagnostic.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const POSTHOG_HOST = "https://us.posthog.com";
const POSTHOG_PROJECT_ID = "373320";
const POSTHOG_KEY =
  Deno.env.get("POSTHOG_PERSONAL_API_KEY") ||
  Deno.env.get("POSTHOG_API_KEY") || "";

async function hogql(query: string): Promise<any[]> {
  const res = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${POSTHOG_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  if (!res.ok) throw new Error(`PostHog ${res.status}: ${await res.text()}`);
  return (await res.json()).results || [];
}

Deno.serve(async () => {
  if (!POSTHOG_KEY) return new Response(JSON.stringify({ error: "no_key" }), { status: 500 });
  try {
    const out: Record<string, any> = {};

    // 30d pageview counts to /reconstruction
    out.pageviews_30d = await hogql(`
      SELECT count() AS n, uniq(distinct_id) AS u
      FROM events WHERE event = '$pageview'
        AND properties.$pathname = '/reconstruction'
        AND timestamp > now() - INTERVAL 30 DAY
    `);

    // All reconstruction_* event counts in 30d
    out.funnel_30d = await hogql(`
      SELECT event, count() AS n, uniq(distinct_id) AS u
      FROM events WHERE event LIKE 'reconstruction_%'
        AND timestamp > now() - INTERVAL 30 DAY
      GROUP BY event ORDER BY n DESC
    `);

    // Decision type selection breakdown
    out.decision_types_30d = await hogql(`
      SELECT properties.decision_type AS dt, count() AS n
      FROM events WHERE event = 'reconstruction_decision_type_selected'
        AND timestamp > now() - INTERVAL 30 DAY
      GROUP BY dt ORDER BY n DESC
    `);

    // Observation key distribution (only completers)
    out.completion_observations_30d = await hogql(`
      SELECT properties.observation_key AS key, count() AS n
      FROM events WHERE event = 'reconstruction_completed'
        AND timestamp > now() - INTERVAL 30 DAY
      GROUP BY key ORDER BY n DESC
    `);

    // Abandonment stage
    out.abandonment_30d = await hogql(`
      SELECT properties.state AS state, properties.last_question AS last_q, count() AS n
      FROM events WHERE event = 'reconstruction_abandoned'
        AND timestamp > now() - INTERVAL 30 DAY
      GROUP BY state, last_q ORDER BY n DESC
    `);

    // Route-taken (the only meaningful conversion: clicking through to case file)
    out.routed_30d = await hogql(`
      SELECT count() AS n, uniq(distinct_id) AS u
      FROM events WHERE event = 'reconstruction_route_taken'
        AND timestamp > now() - INTERVAL 30 DAY
    `);

    // Same but 7d to compare to the briefing window
    out.pageviews_7d = await hogql(`
      SELECT count() AS n, uniq(distinct_id) AS u
      FROM events WHERE event = '$pageview'
        AND properties.$pathname = '/reconstruction'
        AND timestamp > now() - INTERVAL 7 DAY
    `);
    out.funnel_7d = await hogql(`
      SELECT event, count() AS n, uniq(distinct_id) AS u
      FROM events WHERE event LIKE 'reconstruction_%'
        AND timestamp > now() - INTERVAL 7 DAY
      GROUP BY event ORDER BY n DESC
    `);

    return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" }});
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }, null, 2), { status: 500 });
  }
});
