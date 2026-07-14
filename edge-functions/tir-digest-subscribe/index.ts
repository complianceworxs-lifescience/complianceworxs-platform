import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ATTIO_KEY     = Deno.env.get('ATTIO_API_KEY') ?? '';
const ATTIO_API     = 'https://api.attio.com/v2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function attioUpsert(email: string) {
  if (!ATTIO_KEY) return;
  await fetch(`${ATTIO_API}/objects/people/records`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ATTIO_KEY}` },
    body: JSON.stringify({
      data: {
        values: {
          email_addresses:  [{ email_address: email }],
          lifecycle_stage:  'Contact',
          capture_source:   'tir-digest',
          next_action:      'TIR digest subscriber — monitor for engagement.',
        },
      },
    }),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

  let body: { email?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400, headers: CORS });
  }

  // Skip internal addresses
  if (email.endsWith('complianceworxs.com') || email.endsWith('theinspectionrecord.com')) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200, headers: CORS });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Upsert contact in Supabase
  const { data: contact, error } = await supabase
    .from('contacts')
    .upsert(
      {
        email,
        normalized_email:  email,
        lifecycle_stage:   'contact',
        consent_status:    'subscribed',
        consent_source:    'tir_digest',
        consent_timestamp: new Date().toISOString(),
        updated_at:        new Date().toISOString(),
      },
      { onConflict: 'normalized_email', ignoreDuplicates: false }
    )
    .select('id')
    .single();

  if (error) {
    console.error('Contact upsert error:', error);
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500, headers: CORS });
  }

  // Insert lead source
  if (contact?.id) {
    const { data: existing } = await supabase
      .from('lead_sources')
      .select('id')
      .eq('contact_id', contact.id)
      .eq('source', 'tir_digest')
      .maybeSingle();

    if (!existing) {
      await supabase.from('lead_sources').insert({
        contact_id:   contact.id,
        source:       'tir_digest',
        landing_page: 'theinspectionrecord.com',
        first_touch:  true,
        captured_at:  new Date().toISOString(),
      });
    }
  }

  // Sync to Attio
  await attioUpsert(email);

  console.log(`TIR digest subscriber: ${email}`);

  return new Response(
    JSON.stringify({ ok: true }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
});
