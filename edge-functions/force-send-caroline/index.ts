// force-send-caroline — one-off helper
// Reads PHANTOMBUSTER_WEBHOOK_SECRET from env and calls outbound-sender-gmail
// with force_id=465 to bypass the per-domain throttle. Secret never leaves Supabase.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN_SECRET = Deno.env.get('PHANTOMBUSTER_WEBHOOK_SECRET') ?? '';

Deno.serve(async () => {
  if (!ADMIN_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: 'PHANTOMBUSTER_WEBHOOK_SECRET not set in env' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } });
  }

  const url = `${SUPABASE_URL}/functions/v1/outbound-sender-gmail?force_id=465&secret=${encodeURIComponent(ADMIN_SECRET)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE}`,
    },
    body: '{}',
    signal: AbortSignal.timeout(60000),
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
});
