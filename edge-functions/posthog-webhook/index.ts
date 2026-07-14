// posthog-webhook v5 — pass all NOT NULL required columns
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  const properties = (payload.properties ?? {}) as Record<string, unknown>;
  const personProperties = (payload.person?.properties ?? {}) as Record<string, unknown>;
  const email = (properties.email ?? properties['$email'] ?? personProperties.email ?? personProperties['$email'] ?? '') as string;

  if (!email || !email.includes('@') || email.includes('posthog') || email.includes('complianceworxs')) {
    return new Response(JSON.stringify({ skipped: true, reason: 'no valid email or internal address' }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const currentUrl = (properties['$current_url'] ?? '') as string;
  const caseFile = (properties.case_file ?? '') as string;
  const pageSlug = caseFile || currentUrl.replace('https://cases.complianceworxs.com/', '').split('?')[0];
  const emailPrefix = email.split('@')[0];

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: existing } = await supabase.from('warm_outbound_staging').select('id').eq('email', email).maybeSingle();
  if (existing) {
    return new Response(JSON.stringify({ skipped: true, reason: 'already in pipeline', id: existing.id }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const { data: inserted, error } = await supabase
    .from('warm_outbound_staging')
    .insert({
      email,
      full_name: emailPrefix,             // placeholder — prospeo enrichment will fill real name
      linkedin_url: `pending:${email}`,   // placeholder — enrichment will resolve
      source: 'posthog_email_capture',
      enrichment_status: 'pending_enrichment',
      automation_paused: false,
      is_paying_customer: false,
      cohort_label: pageSlug,
      case_file_interest: pageSlug,
      created_at: new Date().toISOString(),
    })
    .select('id').single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  return new Response(
    JSON.stringify({ success: true, id: inserted.id, email, page: pageSlug, action: 'inserted_into_pipeline' }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
});
