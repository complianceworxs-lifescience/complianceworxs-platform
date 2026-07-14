// capture-identity — the single capture endpoint.
// PostHog handles event/behavior tracking. Supabase only stores identity
// (contacts, lead_intents, lead_sources, contact_events).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function callEdgeFunction(name: string, body: unknown) {
  return fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
    body:    JSON.stringify(body),
  }).catch((err: Error) => console.error(`${name} call failed:`, err));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST')   return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

  let body: {
    email?: string;
    session_id?: string;
    user_id?: string;
    source?: string;
    page?: string;
    first_name?: string;
    last_name?: string;
    company?: string;
    case_file?: string;
    metadata?: Record<string, unknown>;
    send_lead_magnet?: string;
  };

  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  const { email, session_id, user_id, source, page, first_name, last_name, company, case_file, metadata, send_lead_magnet } = body;

  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ success: false, error: 'Invalid email' }), { status: 400, headers: CORS });
  }
  if (!source) {
    return new Response(JSON.stringify({ success: false, error: 'Missing source' }), { status: 400, headers: CORS });
  }

  const ne = normalizeEmail(email);
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Upsert contact (single source of truth for identity)
  const contactPayload: Record<string, unknown> = {
    email:             ne,
    normalized_email:  ne,
    lifecycle_stage:   'lead',
    consent_status:    'subscribed',
    consent_source:    source,
    consent_timestamp: new Date().toISOString(),
    updated_at:        new Date().toISOString(),
  };
  if (first_name) contactPayload.first_name = first_name;
  if (last_name)  contactPayload.last_name  = last_name;
  if (company)    contactPayload.company    = company;
  if (user_id) {
    contactPayload.cw_user_id = user_id;
    contactPayload.posthog_distinct_id = user_id;
  }

  const { data: contact, error: ce } = await supabase
    .from('contacts')
    .upsert(contactPayload, { onConflict: 'normalized_email' })
    .select()
    .single();

  if (ce || !contact) {
    console.error('[capture-identity] Contact upsert failed:', ce);
    return new Response(JSON.stringify({ success: false, error: 'Contact error' }), { status: 500, headers: CORS });
  }

  // 2. Lead intent
  const intentPayload: Record<string, unknown> = {
    contact_id:       contact.id,
    last_activity_at: new Date().toISOString(),
    updated_at:       new Date().toISOString(),
  };
  if (case_file) {
    intentPayload.last_case_file_slug  = case_file;
    intentPayload.last_case_file_title = case_file;
  }
  if (send_lead_magnet) intentPayload.last_lead_magnet = send_lead_magnet;
  if (source.includes('lock') || source === 'case_file_lock' || source === 'ddr_gate') {
    intentPayload.lock_viewed = true;
  }

  await supabase.from('lead_intents').upsert(intentPayload, { onConflict: 'contact_id' });

  // 3. Lead source — first touch only
  const { data: existingSource } = await supabase
    .from('lead_sources')
    .select('id')
    .eq('contact_id', contact.id)
    .eq('first_touch', true)
    .maybeSingle();

  if (!existingSource) {
    await supabase.from('lead_sources').insert({
      contact_id:   contact.id,
      source:       source,
      landing_page: page ?? '/',
      first_touch:  true,
      captured_at:  new Date().toISOString(),
    });
  }

  // 4. Contact event (named contact log only — not behavioral analytics)
  await supabase.from('contact_events').insert({
    contact_id:   contact.id,
    event_name:   'identity_captured',
    event_source: source,
    metadata: {
      session_id: session_id ?? null,
      user_id:    user_id    ?? null,
      page:       page       ?? null,
      case_file:  case_file  ?? null,
      ...(metadata ?? {}),
    },
  });

  // 5. Downstream sync — fire and forget. PostHog handles event tracking; no events table write.
  const downstream: Promise<unknown>[] = [
    callEdgeFunction('attio-sync', {
      contactId:      contact.id,
      source_page:    page ?? '/',
      bump_lock_view: !!intentPayload.lock_viewed,
    }),
  ];

  if (send_lead_magnet) {
    downstream.push(
      callEdgeFunction('lead-magnet-send', {
        email: ne,
        first_name: first_name ?? null,
        source: source,
        lead_magnet: send_lead_magnet,
        entry_url: page,
        session_id: session_id,
        user_id: user_id,
        skip_contact_upsert: true,
      })
    );
  }

  await Promise.all(downstream);

  console.log(`[capture-identity] ${ne} \u2190 ${source} \u2014 contact ${contact.id} \u2014 ph_id ${user_id ?? 'none'}`);

  return new Response(
    JSON.stringify({
      success: true,
      contact_id: contact.id,
    }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
});
