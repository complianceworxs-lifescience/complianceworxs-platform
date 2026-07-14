// nurture-link-click-handler
// Receives PostHog $pageview webhook from CW Nurture Link Click Handler hog function (id 019dfa8e-cea1-0000-4cbd-9bdf3d3ab54b)
// and calls Postgres enroll_from_link_click(p_email, p_page_url, p_user_agent, p_ip_address) RPC.
// Returns JSON pass-through from the RPC. verify_jwt=false to match other CW webhook handlers.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function jsonResponse(body, status) {
  if (status === undefined) status = 200;
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { "Content-Type": "application/json" }
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, reason: "method_not_allowed" }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse({ ok: false, reason: "server_misconfigured" }, 500);
  }

  let payload;
  try {
    payload = await req.json();
  } catch (e) {
    return jsonResponse({ ok: false, reason: "invalid_json" }, 400);
  }

  // PostHog hog function sends: { event, person, timestamp, properties: { email, $current_url }, distinct_id }
  const props = payload && payload.properties ? payload.properties : {};
  const person = payload && payload.person ? payload.person : {};
  const personProps = person && person.properties ? person.properties : {};

  const email = props.email || personProps.email || payload.email || null;
  const pageUrl = props["$current_url"] || props.page_url || payload.page_url || null;
  const userAgent = props["$raw_user_agent"] || props.user_agent || req.headers.get("user-agent") || null;
  const ipAddress = props["$ip"] || req.headers.get("x-forwarded-for") || null;

  if (!email) {
    return jsonResponse({ ok: false, reason: "missing_email", received_keys: Object.keys(props) }, 400);
  }
  if (!pageUrl) {
    return jsonResponse({ ok: false, reason: "missing_page_url", received_keys: Object.keys(props) }, 400);
  }

  // Call Postgres function via PostgREST RPC
  const rpcResp = await fetch(SUPABASE_URL + "/rest/v1/rpc/enroll_from_link_click", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SERVICE_KEY,
      "Authorization": "Bearer " + SERVICE_KEY
    },
    body: JSON.stringify({
      p_email: email,
      p_page_url: pageUrl,
      p_user_agent: userAgent,
      p_ip_address: ipAddress
    })
  });

  const rpcText = await rpcResp.text();
  let rpcBody;
  try {
    rpcBody = JSON.parse(rpcText);
  } catch (e) {
    rpcBody = { raw: rpcText };
  }

  if (!rpcResp.ok) {
    return jsonResponse({ ok: false, reason: "rpc_failed", status: rpcResp.status, body: rpcBody }, 502);
  }

  return jsonResponse(rpcBody, 200);
});
