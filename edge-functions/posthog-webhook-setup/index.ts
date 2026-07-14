// posthog-webhook-setup: one-shot function that creates the PostHog webhook action
// pointing at posthog-webhook edge function for email_captured events.
// Reads POSTHOG_API_KEY and POSTHOG_PROJECT_ID from env secrets.

const PH_API_KEY = Deno.env.get('POSTHOG_API_KEY') ?? '';
const PH_PROJECT_ID = Deno.env.get('POSTHOG_PROJECT_ID') ?? '373320';
const WEBHOOK_URL = 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/posthog-webhook';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!PH_API_KEY) {
    return new Response(JSON.stringify({ error: 'POSTHOG_API_KEY not set in env secrets' }), { status: 500, headers: CORS });
  }

  const results: any = { key_found: true, key_prefix: PH_API_KEY.slice(0, 8) + '...', project_id: PH_PROJECT_ID };

  // Step 1: Create a webhook integration in PostHog (if not already there)
  // PostHog free tier supports webhooks via the /api/projects/:id/integrations endpoint
  const integrationRes = await fetch(`https://us.posthog.com/api/projects/${PH_PROJECT_ID}/integrations/`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${PH_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'webhook', config: { url: WEBHOOK_URL } }),
  });
  const integrationText = await integrationRes.text();
  let integrationJson: any = {};
  try { integrationJson = JSON.parse(integrationText); } catch {}
  results.integration = { status: integrationRes.status, body: integrationText.slice(0, 500) };

  const integrationId = integrationJson?.id ?? null;

  if (!integrationId && integrationRes.status !== 200 && integrationRes.status !== 201) {
    // Try listing existing integrations to find if webhook already exists
    const listRes = await fetch(`https://us.posthog.com/api/projects/${PH_PROJECT_ID}/integrations/`, {
      headers: { 'Authorization': `Bearer ${PH_API_KEY}` },
    });
    const listJson = await listRes.json().catch(() => ({}));
    results.existing_integrations = listJson;
  }

  // Step 2: Create a hog function (destination) that fires on email_captured
  const hogRes = await fetch(`https://us.posthog.com/api/projects/${PH_PROJECT_ID}/hog_functions/`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${PH_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Email Capture → Supabase Pipeline',
      description: 'Sends email_captured events to Supabase warm_outbound_staging via posthog-webhook edge function',
      type: 'destination',
      enabled: true,
      filters: { events: [{ id: 'email_captured', name: 'email_captured', type: 'events' }] },
      template_id: 'template-webhook',
      inputs: {
        url: { value: WEBHOOK_URL },
        method: { value: 'POST' },
        headers: { value: { 'Content-Type': 'application/json' } },
        body: { value: JSON.stringify({
          event: '{event.event}',
          distinct_id: '{event.distinct_id}',
          properties: '{event.properties}',
          person: { properties: '{person.properties}' },
        })},
      },
    }),
  });
  const hogText = await hogRes.text();
  results.hog_function = { status: hogRes.status, body: hogText.slice(0, 800) };

  return new Response(JSON.stringify(results, null, 2), { status: 200, headers: CORS });
});
