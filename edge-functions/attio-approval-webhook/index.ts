// attio-approval-webhook v1
//
// Receives Attio Workflow webhook when 'Email Approved' checkbox flips on a person record.
// Looks up the matching warm_outbound_staging row by attio_record_id and sets email_approved=true.
// The outbound-sender cron then picks it up and sends.
//
// Attio Workflow setup:
//   Trigger: Record updated, where Email Approved = true
//   Action: HTTP request POST to this function URL
//   Body: { record_id: "{{record.id}}", email_approved: true }
//
// Auth: requires ?secret= query param (uses PHANTOMBUSTER_WEBHOOK_SECRET as a shared secret).
// Or Authorization: Bearer <secret> header.
//
// Also handles the manual approval path: passing ?staging_id=N&secret=... directly
// approves a row without going through Attio.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SHARED_SECRET = Deno.env.get('PHANTOMBUSTER_WEBHOOK_SECRET') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function extractSecret(req: Request): string | null {
  const url = new URL(req.url);
  const querySecret = url.searchParams.get('secret');
  if (querySecret) return querySecret;
  const auth = req.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const secret = extractSecret(req);
  if (secret !== SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const url = new URL(req.url);

  // Manual override: ?staging_id=N approves a specific staging row
  const stagingIdParam = url.searchParams.get('staging_id');
  if (stagingIdParam) {
    const id = parseInt(stagingIdParam, 10);
    const { data, error } = await supabase
      .from('warm_outbound_staging')
      .update({ email_approved: true, email_approved_at: new Date().toISOString() })
      .eq('id', id)
      .eq('is_paying_customer', false)
      .select('id, full_name, email, fit_score')
      .single();
    if (error) return new Response(JSON.stringify({ error: 'update_failed', detail: error.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
    return new Response(JSON.stringify({ ok: true, mode: 'manual', approved: data }, null, 2), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Webhook path: parse body for record_id (Attio Workflow payload)
  let body: any = {};
  try {
    if (req.method === 'POST') body = await req.json();
  } catch { /* tolerate empty body */ }

  // Attio Workflow webhook may send: { record_id, email_approved, ... } or { data: { id: { record_id }, ... } }
  const recordId = body.record_id
    || body.data?.id?.record_id
    || body.record?.id?.record_id
    || url.searchParams.get('record_id');

  if (!recordId) {
    return new Response(JSON.stringify({
      error: 'missing_record_id',
      hint: 'Send POST body with {record_id: "<attio-uuid>"} or query param record_id=<uuid>',
      received_body_keys: Object.keys(body),
    }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Lookup matching staging row
  const { data: lead, error: lookupErr } = await supabase
    .from('warm_outbound_staging')
    .select('id, full_name, email, is_paying_customer, dispatched_at, first_touch_draft_body, fit_score')
    .eq('attio_record_id', recordId)
    .maybeSingle();

  if (lookupErr) {
    return new Response(JSON.stringify({ error: 'lookup_failed', detail: lookupErr.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  if (!lead) {
    return new Response(JSON.stringify({ error: 'no_staging_row', record_id: recordId }), {
      status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  if (lead.is_paying_customer) {
    return new Response(JSON.stringify({ error: 'paying_customer_blocked', name: lead.full_name }), {
      status: 409, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  if (lead.dispatched_at) {
    return new Response(JSON.stringify({ error: 'already_sent', name: lead.full_name, dispatched_at: lead.dispatched_at }), {
      status: 409, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  if (!lead.first_touch_draft_body) {
    return new Response(JSON.stringify({ error: 'no_draft_yet', name: lead.full_name, hint: 'Wait for first-touch-drafter cron to populate draft' }), {
      status: 409, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Approve
  const { error: updateErr } = await supabase
    .from('warm_outbound_staging')
    .update({ email_approved: true, email_approved_at: new Date().toISOString() })
    .eq('id', lead.id);

  if (updateErr) {
    return new Response(JSON.stringify({ error: 'approve_failed', detail: updateErr.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    mode: 'webhook',
    approved: { id: lead.id, name: lead.full_name, email: lead.email, fit_score: lead.fit_score },
    message: 'Email queued for send. Will dispatch on next outbound-sender cron tick (within 5 min).',
  }, null, 2), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
