import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function callEdgeFunction(name: string, body: unknown) {
  return fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
    body: JSON.stringify(body),
  }).catch((err: Error) => console.error(`${name} call failed:`, err));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
  }
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  let body: { name: string; email: string; company: string; title: string; riskLevel: string; primaryGap: string; gaps: string[]; source?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }

  const { name, email, company, title, riskLevel, primaryGap, gaps, source } = body;
  if (!email || !name) return new Response(JSON.stringify({ error: 'email and name required' }), { status: 400 });

  const ne = normalizeEmail(email);
  const nameParts = name.trim().split(' ');
  const firstName = nameParts[0] ?? null;
  const lastName  = nameParts.slice(1).join(' ') || null;

  // 1. Upsert contact
  const { data: contact, error: ce } = await supabase
    .from('contacts')
    .upsert({ email: ne, normalized_email: ne, full_name: name, first_name: firstName, last_name: lastName, company: company ?? null, job_title: title ?? null, lifecycle_stage: 'lead', consent_status: 'subscribed', consent_source: 'decision_ownership_assessment', consent_timestamp: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'normalized_email' })
    .select().single();

  if (ce || !contact) {
    console.error('Contact upsert failed:', ce);
    return new Response(JSON.stringify({ ok: false, error: 'Contact upsert failed' }), { status: 500 });
  }

  // 2. Upsert lead_intents
  await supabase.from('lead_intents').upsert({ contact_id: contact.id, assessment_completed: true, high_intent: riskLevel === 'elevated', last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'contact_id' });

  // 3. Insert lead_source if first touch
  const { data: existingSource } = await supabase.from('lead_sources').select('id').eq('contact_id', contact.id).eq('first_touch', true).maybeSingle();
  if (!existingSource) {
    await supabase.from('lead_sources').insert({ contact_id: contact.id, source: source ?? 'direct', landing_page: '/decision-ownership/start', first_touch: true, captured_at: new Date().toISOString() });
  }

  // 4. Log contact event
  await supabase.from('contact_events').insert({ contact_id: contact.id, event_name: 'assessment_completed', event_source: 'decision_ownership_assessment', metadata: { risk_level: riskLevel, primary_gap: primaryGap, gaps } });

  // 5. Sync to Attio + trigger outreach pipeline (MailerLite removed)
  await Promise.all([
    callEdgeFunction('attio-sync', { contactId: contact.id }),
    callEdgeFunction('lead-outreach-email', {
      record: { id: contact.id, email: ne, name, first_name: firstName, company: company ?? null, title: title ?? null, source: 'decision-ownership-assessment', page: '/decision-ownership/start' }
    }),
  ]);

  return new Response(JSON.stringify({ ok: true, contactId: contact.id }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
});
