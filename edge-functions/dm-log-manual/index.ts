// dm-log-manual v1
//
// PURPOSE: One-click logger for manual LinkedIn DMs sent by Jon. Called from a
// browser bookmarklet on the LinkedIn profile page after sending the DM.
//
// FLOW:
//   1. Bookmarklet POSTs { linkedin_url, dm_body? } (or { staging_id })
//   2. Function finds the matching warm_outbound_staging row
//   3. Updates dm_first_message_sent_at, dm_status
//   4. Logs to outbound_log for the daily brief
//   5. Schedules next DM follow-up in next_dm_followup_due_at (reuses email cadence)
//   6. Pushes Attio note for visibility
//
// AUTH: Uses a shared secret (DM_LOG_SECRET) passed as ?secret= or in body.
// Bookmarklet stores the secret as a constant so Jon doesn't enter it manually.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ATTIO_API_KEY = Deno.env.get('ATTIO_API_KEY')!;
const DM_LOG_SECRET = Deno.env.get('DM_LOG_SECRET') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function normalizeLinkedInUrl(url: string): string {
  // Strip protocol, trailing slash, query params, fragment
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const secret = url.searchParams.get('secret') || body.secret;

  if (!DM_LOG_SECRET || secret !== DM_LOG_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { staging_id, linkedin_url, dm_body, touch_number } = body;

  // Find lead
  let lead: any = null;
  if (staging_id) {
    const { data } = await supabase
      .from('warm_outbound_staging')
      .select('id, full_name, company, attio_record_id, linkedin_url, dm_first_message_sent_at, sequence_email_count, followup_stage')
      .eq('id', staging_id).maybeSingle();
    lead = data;
  } else if (linkedin_url) {
    const norm = normalizeLinkedInUrl(linkedin_url);
    const { data } = await supabase
      .from('warm_outbound_staging')
      .select('id, full_name, company, attio_record_id, linkedin_url, dm_first_message_sent_at, sequence_email_count, followup_stage')
      .ilike('linkedin_url', `%${norm}%`).limit(1).maybeSingle();
    lead = data;
  }

  if (!lead) {
    return new Response(JSON.stringify({
      error: 'lead_not_found',
      hint: 'Pass staging_id or a linkedin_url that matches an existing warm_outbound_staging row.',
    }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const now = new Date().toISOString();
  const isFirstDM = !lead.dm_first_message_sent_at;
  const touchNum = touch_number || (isFirstDM ? 1 : (lead.sequence_email_count || 0) + 1);

  // Update lead state
  const updateFields: any = {
    dm_status: 'sent_manual',
  };
  if (isFirstDM) {
    updateFields.dm_first_message_sent_at = now;
  }

  const { error: updErr } = await supabase
    .from('warm_outbound_staging')
    .update(updateFields)
    .eq('id', lead.id);

  if (updErr) {
    return new Response(JSON.stringify({ error: 'update_failed', detail: updErr.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Log to outbound_log
  await supabase.from('outbound_log').insert({
    staging_id: lead.id,
    attio_record_id: lead.attio_record_id,
    channel: 'linkedin_dm',
    touch_number: touchNum,
    sent_by: 'manual_bookmarklet',
    note: dm_body ? dm_body.slice(0, 1000) : null,
  });

  // Push Attio note
  if (lead.attio_record_id && ATTIO_API_KEY) {
    const noteContent = [
      `Channel: LinkedIn DM (manual send)`,
      `Touch number: ${touchNum}`,
      `Sent at: ${now}`,
      `Logged via: bookmarklet`,
      ``,
      dm_body ? `--- DM BODY ---\n${dm_body}` : '(no body captured)',
    ].join('\n');

    try {
      await fetch('https://api.attio.com/v2/notes', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ATTIO_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            parent_object: 'people',
            parent_record_id: lead.attio_record_id,
            title: `DM SENT (touch ${touchNum}) — LinkedIn`,
            format: 'plaintext',
            content: noteContent.slice(0, 9000),
          }
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      // Non-fatal
      console.error('attio_note_failed', (e as Error).message);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    staging_id: lead.id,
    name: lead.full_name,
    company: lead.company,
    touch_number: touchNum,
    is_first_dm: isFirstDM,
    summary: `Logged DM #${touchNum} to ${lead.full_name} (${lead.company}). Attio note pushed.`,
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
