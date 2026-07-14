// reconstruction-dropoff-probe — one-shot diagnostic.
// Question: of the 9 people who completed /reconstruction and clicked through to
// the CAPA case file, what did they actually do on arrival?
// We trace their distinct_id across both event streams.

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

    // 1. Who routed through (distinct IDs of the 9 click-throughs)
    out.routers = await hogql(`
      SELECT distinct_id, min(timestamp) AS routed_at
      FROM events
      WHERE event = 'reconstruction_route_taken'
        AND timestamp > now() - INTERVAL 14 DAY
      GROUP BY distinct_id ORDER BY routed_at
    `);

    // 2. For those distinct_ids, what events fired on cases.complianceworxs.com after the route?
    out.post_route_activity = await hogql(`
      WITH routers AS (
        SELECT distinct_id, min(timestamp) AS routed_at
        FROM events
        WHERE event = 'reconstruction_route_taken'
          AND timestamp > now() - INTERVAL 14 DAY
        GROUP BY distinct_id
      )
      SELECT e.distinct_id, e.event,
        e.properties.$pathname AS path,
        e.properties.$current_url AS url,
        e.timestamp
      FROM events e
      INNER JOIN routers r ON e.distinct_id = r.distinct_id
      WHERE e.timestamp >= r.routed_at
        AND e.timestamp < r.routed_at + INTERVAL 2 HOUR
        AND e.event != 'reconstruction_route_taken'
      ORDER BY e.distinct_id, e.timestamp
    `);

    // 3. Which pages did the 9 routers land on first after the click?
    out.first_landing = await hogql(`
      WITH routers AS (
        SELECT distinct_id, min(timestamp) AS routed_at
        FROM events
        WHERE event = 'reconstruction_route_taken'
          AND timestamp > now() - INTERVAL 14 DAY
        GROUP BY distinct_id
      ),
      first_pv AS (
        SELECT e.distinct_id, e.timestamp, e.properties.$pathname AS path, e.properties.$current_url AS url,
          row_number() OVER (PARTITION BY e.distinct_id ORDER BY e.timestamp) AS rn
        FROM events e
        INNER JOIN routers r ON e.distinct_id = r.distinct_id
        WHERE e.event = '$pageview'
          AND e.timestamp >= r.routed_at
          AND e.timestamp < r.routed_at + INTERVAL 2 HOUR
      )
      SELECT path, count(*) AS n FROM first_pv WHERE rn = 1 GROUP BY path ORDER BY n DESC
    `);

    // 4. Per-router event count after routing (engagement signal)
    out.per_router_engagement = await hogql(`
      WITH routers AS (
        SELECT distinct_id, min(timestamp) AS routed_at
        FROM events
        WHERE event = 'reconstruction_route_taken'
          AND timestamp > now() - INTERVAL 14 DAY
        GROUP BY distinct_id
      )
      SELECT r.distinct_id,
        r.routed_at,
        count(e.event) AS events_after,
        sum(if(e.event = '$pageview', 1, 0)) AS pageviews,
        sum(if(e.event = 'lock_view', 1, 0)) AS lock_views,
        sum(if(e.event = 'email_gate_submitted', 1, 0)) AS email_captures,
        sum(if(e.event = 'cta_click', 1, 0)) AS cta_clicks,
        sum(if(e.event = 'purchase', 1, 0)) AS purchases,
        max(e.timestamp) AS last_activity
      FROM routers r
      LEFT JOIN events e
        ON e.distinct_id = r.distinct_id
        AND e.timestamp >= r.routed_at
        AND e.timestamp < r.routed_at + INTERVAL 2 HOUR
        AND e.event != 'reconstruction_route_taken'
      GROUP BY r.distinct_id, r.routed_at
      ORDER BY events_after DESC
    `);

    // 5. Sessions that returned later (came back beyond the 2h window)
    out.returners = await hogql(`
      WITH routers AS (
        SELECT distinct_id, min(timestamp) AS routed_at
        FROM events
        WHERE event = 'reconstruction_route_taken'
          AND timestamp > now() - INTERVAL 14 DAY
        GROUP BY distinct_id
      )
      SELECT count(DISTINCT e.distinct_id) AS n
      FROM events e
      INNER JOIN routers r ON e.distinct_id = r.distinct_id
      WHERE e.timestamp >= r.routed_at + INTERVAL 2 HOUR
        AND e.event = '$pageview'
    `);

    // 6. Did any of them ever see a Stripe checkout page?
    out.stripe_checkouts = await hogql(`
      WITH routers AS (
        SELECT distinct_id, min(timestamp) AS routed_at
        FROM events
        WHERE event = 'reconstruction_route_taken'
          AND timestamp > now() - INTERVAL 14 DAY
        GROUP BY distinct_id
      )
      SELECT e.distinct_id, e.event, e.timestamp, e.properties.$current_url AS url
      FROM events e
      INNER JOIN routers r ON e.distinct_id = r.distinct_id
      WHERE e.timestamp >= r.routed_at
        AND (
          e.properties.$current_url LIKE '%stripe%'
          OR e.properties.$pathname LIKE '%checkout%'
          OR e.event = 'purchase'
          OR e.event = 'cta_click'
        )
      ORDER BY e.distinct_id, e.timestamp
    `);

    return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" }});
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }, null, 2), { status: 500 });
  }
});
