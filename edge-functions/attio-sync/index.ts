// attio-sync v3 — May 7 2026
// V3: Queue drainer pattern. Reads attio_sync_queue, PATCHes Attio, marks rows synced or failed.
// Replaces the old contact-based push. No more reads from dropped contacts/contact_events tables.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ATTIO_API_KEY = Deno.env.get('ATTIO_API_KEY') ?? '';
const ATTIO_BASE    = 'https://api.attio.com/v2';

const MAX_RETRIES = 3;
const BATCH_SIZE  = 50;

async function attioRequest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${ATTIO_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ATTIO_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Attio ${method} ${path} \u2192 ${res.status}: ${text}`);
  return JSON.parse(text);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Pull pending queue rows (oldest first, max BATCH_SIZE per run)
  const { data: queue, error: qErr } = await supabase
    .from('attio_sync_queue')
    .select('*')
    .eq('sync_status', 'pending')
    .lt('retry_count', MAX_RETRIES)
    .order('triggered_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (qErr) {
    console.error('Queue read error:', qErr);
    return new Response(JSON.stringify({ ok: false, error: qErr.message }), { status: 500 });
  }

  if (!queue || queue.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0, message: 'queue empty' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let synced = 0;
  let failed = 0;

  for (const row of queue) {
    const objectType = row.object_type || 'people';
    const path = `/objects/${objectType}/records/${row.attio_record_id}`;
    
    try {
      // PATCH the Attio record with the queued payload
      await attioRequest('PATCH', path, {
        data: { values: row.update_payload }
      });

      // Mark synced
      await supabase
        .from('attio_sync_queue')
        .update({ sync_status: 'synced', synced_at: new Date().toISOString(), error_msg: null })
        .eq('id', row.id);

      synced++;
    } catch (err) {
      const errMsg = String(err).slice(0, 500);
      const newRetryCount = (row.retry_count || 0) + 1;
      const nowFailed = newRetryCount >= MAX_RETRIES;

      await supabase
        .from('attio_sync_queue')
        .update({
          sync_status: nowFailed ? 'failed' : 'pending',
          retry_count: newRetryCount,
          error_msg: errMsg,
        })
        .eq('id', row.id);

      console.error(`Sync failed for queue row ${row.id} (attempt ${newRetryCount}):`, errMsg);
      failed++;
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed: queue.length, synced, failed }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
