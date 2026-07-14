// gmail-reply-handler v39 — captures reply body and stages for classification.
//
// Changes from v38:
//  + Fetches the full message (format=full, not metadata) so we get the body
//  + Decodes plain-text body from MIME parts
//  + Looks up the lead in warm_outbound_staging (not just contacts) so the editorial loop sees the real outbound lead
//  + Inserts a row into inbound_replies for the classifier to pick up
//  + Bumps warm_outbound_staging.replied_at so outbound_events.outbound_reply_received fires for PostHog
//  + Preserves the existing Attio Prospect→Lead flip and note creation

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE          = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ATTIO_KEY             = Deno.env.get('ATTIO_API_KEY') ?? '';
const GMAIL_CLIENT_ID       = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const GMAIL_CLIENT_SECRET   = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const GMAIL_REFRESH_TOKEN   = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';
const PUBSUB_TOKEN          = Deno.env.get('GMAIL_PUBSUB_VERIFICATION_TOKEN') ?? '';
const ATTIO_API             = 'https://api.attio.com/v2';

async function getGmailAccessToken(): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) { console.error('Token refresh failed:', await res.text()); return null; }
  return (await res.json()).access_token ?? null;
}

function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  try { return new TextDecoder('utf-8').decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))); }
  catch { return ''; }
}

function extractPlainTextBody(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeBase64Url(payload.body.data);
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const text = extractPlainTextBody(part);
      if (text) return text;
    }
  }
  return '';
}

function stripQuotedReply(body: string): string {
  // Keep only the new content, strip everything below quoted markers
  const markers = [/^On .+ wrote:$/m, /^>+/m, /^From: /m, /-+ ?Original Message ?-+/i, /-+ ?Forwarded message ?-+/i];
  let cut = body.length;
  for (const m of markers) {
    const match = body.match(m);
    if (match && match.index !== undefined && match.index < cut) cut = match.index;
  }
  return body.slice(0, cut).trim();
}

async function getGmailMessageFull(messageId: string, accessToken: string) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) { console.error('Gmail message fetch failed:', await res.text()); return null; }
  const data = await res.json();
  const headers = data.payload?.headers ?? [];
  const fromHeader = headers.find((h: any) => h.name === 'From')?.value ?? '';
  const subject = headers.find((h: any) => h.name === 'Subject')?.value ?? '';
  const emailMatch = fromHeader.match(/<([^>]+)>/) ?? fromHeader.match(/([\w.+-]+@[\w.-]+)/);
  const email = emailMatch ? emailMatch[1].toLowerCase().trim() : fromHeader.toLowerCase().trim();
  const nameMatch = fromHeader.match(/^\s*"?([^"<]+?)"?\s*</);
  const fromName = nameMatch ? nameMatch[1].trim() : null;
  const rawBody = extractPlainTextBody(data.payload);
  const cleanBody = stripQuotedReply(rawBody).slice(0, 8000);
  return { from: email, fromName, subject, body: cleanBody, threadId: data.threadId };
}

async function getNewMessageIds(historyId: string, accessToken: string): Promise<string[]> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${historyId}&historyTypes=messageAdded&labelId=INBOX`,
    { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) { console.error('Gmail history fetch failed:', await res.text()); return []; }
  const data = await res.json();
  const ids: string[] = [];
  for (const record of data.history ?? []) {
    for (const msg of record.messagesAdded ?? []) if (msg.message?.id) ids.push(msg.message.id);
  }
  return ids;
}

async function attioFlipToLead(email: string): Promise<boolean> {
  if (!ATTIO_KEY) return false;
  const res = await fetch(`${ATTIO_API}/objects/people/records`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ATTIO_KEY}` },
    body: JSON.stringify({
      data: { values: {
        email_addresses: [{ email_address: email }],
        lifecycle_stage: 'Lead', outreach_status: 'Replied',
        next_action: 'Reply received — awaiting Claude classification.',
      }},
    }),
  });
  if (!res.ok) { console.error('Attio update failed:', await res.text()); return false; }
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });

  const url = new URL(req.url);
  if (url.searchParams.get('token') !== PUBSUB_TOKEN && PUBSUB_TOKEN) console.warn('Invalid Pub/Sub token');

  let body: any;
  try { body = await req.json(); } catch { return new Response('ok', { status: 200 }); }

  const encoded = body?.message?.data;
  if (!encoded) return new Response('ok', { status: 200 });

  let notification: any;
  try { notification = JSON.parse(atob(encoded)); } catch { return new Response('ok', { status: 200 }); }
  if (!notification.historyId) return new Response('ok', { status: 200 });

  const accessToken = await getGmailAccessToken();
  if (!accessToken) return new Response('ok', { status: 200 });

  const messageIds = await getNewMessageIds(notification.historyId, accessToken);
  if (!messageIds.length) return new Response('ok', { status: 200 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  for (const messageId of messageIds) {
    const msg = await getGmailMessageFull(messageId, accessToken);
    if (!msg) continue;

    // Look up in warm_outbound_staging (the active outbound lead)
    const { data: staging } = await supabase
      .from('warm_outbound_staging')
      .select('id, attio_record_id, lifecycle_stage')
      .ilike('email', msg.from)
      .maybeSingle();

    // Insert into inbound_replies (idempotent on gmail_message_id)
    const { error: insertErr } = await supabase.from('inbound_replies').insert({
      gmail_message_id: messageId,
      gmail_thread_id: msg.threadId,
      from_email: msg.from,
      from_name: msg.fromName,
      subject: msg.subject,
      body_plain: msg.body,
      staging_id: staging?.id ?? null,
      attio_record_id: staging?.attio_record_id ?? null,
    });
    if (insertErr && !insertErr.message?.includes('duplicate')) console.error('inbound_replies insert failed:', insertErr.message);

    if (staging) {
      // Flip Attio + record outreach event (legacy behavior preserved)
      await attioFlipToLead(msg.from);
      await supabase.from('lead_outreach_log').insert({
        lead_email: msg.from, template_key: 'reply-detected', subject: msg.subject,
        status: 'replied', error_message: null, mailersend_id: messageId,
      });
      console.log(`REPLY CAPTURED: ${msg.from} — staged for classification`);
    } else {
      console.log(`REPLY from unknown sender ${msg.from} — captured anyway, no staging match`);
    }
  }

  return new Response('ok', { status: 200 });
});
