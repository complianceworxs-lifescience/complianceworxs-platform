// Thin wrapper around capture-identity. Preserves /ddr-gate-capture endpoint
// for any existing case file lock code that still posts here.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS });
  }

  // Translate legacy ddr-gate-capture payload → capture-identity payload
  const caseFile = body.case_file_id ?? body.ddr_slug ?? null;
  const payload = {
    email:      body.email,
    session_id: body.session_id ?? null,
    user_id:    body.user_id    ?? null,
    source:     'case_file_lock',
    page:       body.source_page ?? (caseFile ? `/${caseFile}` : '/'),
    case_file:  caseFile,
    metadata: {
      ddr_slug:           body.ddr_slug ?? null,
      case_file_id:       body.case_file_id ?? null,
      case_file_industry: body.case_file_industry ?? 'pharma',
    },
  };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/capture-identity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  return new Response(
    JSON.stringify({
      success: result.success,
      contactId: result.contact_id,
    }),
    { status: res.status, headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
});
