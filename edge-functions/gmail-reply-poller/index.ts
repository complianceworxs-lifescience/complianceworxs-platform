// gmail-reply-poller v5 — May 24 2026
// V5 CHANGES (vs v4):
//   1. Adds detectBounce() — recognizes Exchange/O365/Postfix/Gmail bounce patterns by subject + body.
//   2. Bounces are classified as sentiment='bounce', not 'unclear', and inbound_log.handled_at is
//      auto-set so they don't pollute the unhandled-replies queue.
//   3. Bounces mark the staging row: delivery_status='bounce', automation_paused=true with reason.
//   4. Auto-replies (OOO etc) now also auto-set handled_at — there is nothing for a human to do
//      with an OOO; the existing archive logic was sufficient.
//   5. New sender exclusions: postmaster, mailer-daemon, mail delivery, delivery status notification.
//
// V4 CHANGES (vs v3):
//   1. Drops the `is:inbox` restriction. Replies that have been auto-archived by
//      Gmail filters were invisible. New scope: `in:anywhere` minus Spam/Trash.
//   2. Adds a more aggressive sender-domain match: pulls every domain we've sent to
//      and includes `from:domain.com` matches even when threading is broken.
//   3. Records the message's current label set in the inbound_log note for diagnostics.
//   4. Increases lookback to 30 days for the first run after deploy (catches backfill).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GMAIL_CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const GMAIL_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const GMAIL_REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';

const SEARCH_QUERY_DEFAULT = '(in:anywhere -in:spam -in:trash) newer_than:14d';
const EXCLUDED_FROM_DOMAINS = ['linkedin.com', 'google.com', 'noreply', 'no-reply', 'phantombuster.com', 'mg.phantombuster.com', 'yelp.com'];

async function getAccessToken(): Promise<string | null> {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) return null;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GMAIL_CLIENT_ID,
        client_secret: GMAIL_CLIENT_SECRET,
        refresh_token: GMAIL_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.access_token || null;
  } catch { return null; }
}

async function searchMessages(token: string, query: string): Promise<string[]> {
  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=200`,
      { headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(15000) }
    );
    if (!r.ok) return [];
    const j = await r.json();
    return (j.messages || []).map((m: any) => m.id);
  } catch { return []; }
}

function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return new TextDecoder('utf-8').decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
  } catch { return ''; }
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
  const markers = [/^On .+ wrote:$/m, /^>+/m, /^From: /m, /-+ ?Original Message ?-+/i, /-+ ?Forwarded message ?-+/i];
  let cut = body.length;
  for (const m of markers) {
    const match = body.match(m);
    if (match && match.index !== undefined && match.index < cut) cut = match.index;
  }
  return body.slice(0, cut).trim();
}

function detectAutoReply(subject: string, body: string): boolean {
  const s = (subject || '').toLowerCase();
  const b = (body || '').toLowerCase();
  return (
    s.startsWith('automatic reply') ||
    s.startsWith('auto reply') ||
    s.startsWith('auto-reply') ||
    s.startsWith('out of office') ||
    s.includes('autoreply') ||
    s.includes('automatische antwort') ||
    s.includes('abwesend') ||
    b.includes('i am no longer') ||
    b.includes('no longer with') ||
    b.includes('mailbox is no longer monitored') ||
    b.includes('out of office') ||
    b.includes('on vacation') ||
    b.includes('away from the office') ||
    b.includes('on annual leave') ||
    b.includes('currently on leave') ||
    b.includes('abwesend')
  );
}

// v5: distinguish bounces from real human replies / OOOs.
// Returns one of 'hard', 'soft', or null.
function detectBounce(subject: string, body: string, fromHeader: string): 'hard' | 'soft' | null {
  const s = (subject || '').toLowerCase();
  const b = (body || '').toLowerCase();
  const f = (fromHeader || '').toLowerCase();

  const senderIsDaemon =
    f.includes('postmaster@') ||
    f.includes('mailer-daemon') ||
    f.includes('mail delivery') ||
    f.includes('delivery status notification');

  const subjectIsBounce =
    s.startsWith('undeliverable') ||
    s.startsWith('undelivered') ||
    s.startsWith('delivery status notification') ||
    s.startsWith('mail delivery failed') ||
    s.startsWith('returned mail') ||
    s.includes('could not be delivered') ||
    s.includes('delivery failure');

  const bodyIsBounce =
    b.includes('rejected your message') ||
    b.includes("your message wasn't delivered") ||
    b.includes('your message was not delivered') ||
    b.includes('delivery has failed') ||
    b.includes('message could not be delivered') ||
    b.includes('address rejected') ||
    b.includes('recipient address rejected') ||
    b.includes('user unknown') ||
    b.includes('no such user') ||
    b.includes('mailbox unavailable') ||
    b.includes('relay access denied') ||
    b.includes('550 5.') ||
    b.includes('554 5.') ||
    b.includes('552 5.');

  if (!(senderIsDaemon || subjectIsBounce || bodyIsBounce)) return null;

  // Hard vs soft: hard means address is gone for good. Soft means transient.
  const hardSignals = [
    '550 5.1.1', '550 5.1.10', '550 5.4.1',
    'no such user', 'user unknown', 'recipient address rejected',
    'address rejected', 'mailbox unavailable',
    "the email address you entered couldn't be found",
    "couldn't be delivered to",
  ];
  const softSignals = [
    '421 ', '450 ', '451 ', '452 ',
    'try again later', 'temporarily', 'temporary failure',
    'quota exceeded', 'mailbox full',
  ];
  for (const sig of hardSignals) if (b.includes(sig)) return 'hard';
  for (const sig of softSignals) if (b.includes(sig)) return 'soft';
  // Default: if it looks like a bounce but we can't classify, treat as hard.
  // That's safer than continuing to email a likely-bad address.
  return 'hard';
}

// v5: extract the failed recipient email from a bounce body, when possible.
function extractBouncedRecipient(body: string): string | null {
  // Common patterns: "rejected your message to ... <user@domain>" or just "user@domain"
  const patterns = [
    /rejected your message to[^<]*<([\w.+-]+@[\w.-]+)>/i,
    /rejected your message to the following email addresses[^\w]*([\w.+-]+@[\w.-]+)/i,
    /to[\s]+([\w.+-]+@[\w.-]+)[\s]+failed/i,
    /<([\w.+-]+@[\w.-]+)>:?\s*(?:host|recipient|user|address)/i,
  ];
  for (const p of patterns) {
    const m = body.match(p);
    if (m) return m[1].toLowerCase().trim();
  }
  return null;
}

function extractRedirect(body: string): { name: string | null; email: string | null } {
  const emailMatch = body.match(/([\w.+-]+@[\w.-]+\.[\w]+)/);
  const email = emailMatch ? emailMatch[1] : null;
  const namePatterns = [
    /(?:please (?:contact|direct|email|reach out to|redirect[^a-z]+to)\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/,
    /(?:redirect all (?:correspondance|correspondence)[^a-z]+to\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
    /(?:please direct your (?:inquiry|inquiries)[^a-z]+to\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
  ];
  let name: string | null = null;
  for (const p of namePatterns) {
    const m = body.match(p);
    if (m) { name = m[1].trim(); break; }
  }
  return { name, email };
}

function extractSenderDomain(fromHeader: string): string | null {
  const emailMatch = fromHeader.match(/<([^>]+)>/) ?? fromHeader.match(/([\w.+-]+@[\w.-]+)/);
  if (!emailMatch) return null;
  const email = emailMatch[1].toLowerCase().trim();
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1) : null;
}

async function getMessage(token: string, messageId: string) {
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(15000) }
  );
  if (!r.ok) return null;
  const data = await r.json();
  const headers = data.payload?.headers ?? [];
  const fromHeader = headers.find((h: any) => h.name === 'From')?.value ?? '';
  const subject = headers.find((h: any) => h.name === 'Subject')?.value ?? '';
  const emailMatch = fromHeader.match(/<([^>]+)>/) ?? fromHeader.match(/([\w.+-]+@[\w.-]+)/);
  const email = emailMatch ? emailMatch[1].toLowerCase().trim() : fromHeader.toLowerCase().trim();
  const nameMatch = fromHeader.match(/^\s*"?([^"<]+?)"?\s*</);
  const fromName = nameMatch ? nameMatch[1].trim() : null;
  const rawBody = extractPlainTextBody(data.payload);
  const cleanBody = stripQuotedReply(rawBody).slice(0, 8000);
  const labelIds: string[] = data.labelIds || [];
  return { from: email, fromName, fromHeader, subject, body: cleanBody, threadId: data.threadId, messageId, labelIds };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === '1';
  const lookbackDays = parseInt(url.searchParams.get('days') || '14', 10);
  const customQuery = url.searchParams.get('q');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const token = await getAccessToken();
  if (!token) return new Response(JSON.stringify({ ok: false, error: 'gmail_auth_failed' }), { status: 503 });

  const searchQuery = customQuery || `(in:anywhere -in:spam -in:trash) newer_than:${lookbackDays}d`;
  const messageIds = await searchMessages(token, searchQuery);

  if (!messageIds.length) {
    return new Response(JSON.stringify({ ok: true, query: searchQuery, found: 0, new: 0, inserted: 0 }));
  }

  const { data: existing } = await supabase
    .from('inbound_log')
    .select('note')
    .eq('detected_by', 'gmail-reply-poller')
    .gte('received_at', new Date(Date.now() - 60 * 86400 * 1000).toISOString());
  const existingIds = new Set(
    (existing || [])
      .map((r: any) => (r.note || '').match(/gmail_id:([\w-]+)/)?.[1])
      .filter(Boolean)
  );
  const newIds = messageIds.filter(id => !existingIds.has(id));

  const { data: outboundRecipients } = await supabase
    .from('warm_outbound_staging')
    .select('id, email, company_domain, attio_record_id, full_name, company')
    .not('email', 'is', null);
  const recipientMapByEmail = new Map<string, any>();
  const recipientMapByDomain = new Map<string, any[]>();
  for (const row of (outboundRecipients || [])) {
    if (row.email) recipientMapByEmail.set(row.email.toLowerCase().trim(), row);
    if (row.company_domain) {
      const d = row.company_domain.toLowerCase().trim();
      if (!recipientMapByDomain.has(d)) recipientMapByDomain.set(d, []);
      recipientMapByDomain.get(d)!.push(row);
    }
  }

  let inserted = 0;
  let auto_replies = 0;
  let real_replies = 0;
  let bounces_hard = 0;
  let bounces_soft = 0;
  let redirects_logged = 0;
  let skipped_excluded = 0;
  let skipped_no_match = 0;
  let matched_by_domain = 0;
  const samples: any[] = [];

  for (const messageId of newIds.slice(0, 100)) {
    const msg = await getMessage(token, messageId);
    if (!msg) continue;

    const fromDomain = extractSenderDomain(msg.fromHeader);
    if (EXCLUDED_FROM_DOMAINS.some(ex => msg.fromHeader.toLowerCase().includes(ex))) {
      skipped_excluded++;
      continue;
    }

    // v5: classify before matching. Bounces won't match by sender (postmaster@) so try
    // extracting the failed recipient from the body and look that up instead.
    const bounceType = detectBounce(msg.subject, msg.body, msg.fromHeader);
    const isAuto = !bounceType && detectAutoReply(msg.subject, msg.body);

    let staging: any = null;
    let matchedHow = 'none';

    if (bounceType) {
      const failedRecipient = extractBouncedRecipient(msg.body);
      if (failedRecipient) {
        staging = recipientMapByEmail.get(failedRecipient);
        matchedHow = staging ? 'bounce_failed_recipient' : 'none';
      }
      // Fall back to domain-of-failed-recipient if we have it
      if (!staging && failedRecipient) {
        const at = failedRecipient.lastIndexOf('@');
        if (at > 0) {
          const fd = failedRecipient.slice(at + 1);
          const candidates = recipientMapByDomain.get(fd) || [];
          if (candidates.length >= 1) {
            staging = candidates[0];
            matchedHow = `bounce_domain_${candidates.length}`;
            matched_by_domain++;
          }
        }
      }
    } else {
      // Normal path: real reply or OOO. Match by From: email or sender domain.
      staging = recipientMapByEmail.get(msg.from);
      matchedHow = staging ? 'email' : 'none';

      if (!staging && fromDomain && recipientMapByDomain.has(fromDomain)) {
        const candidates = recipientMapByDomain.get(fromDomain)!;
        if (candidates.length === 1) {
          staging = candidates[0];
          matchedHow = 'domain_unique';
          matched_by_domain++;
        } else {
          staging = candidates[0];
          matchedHow = `domain_multi_${candidates.length}`;
          matched_by_domain++;
        }
      }
    }

    if (!staging) { skipped_no_match++; continue; }

    const sentiment = bounceType ? 'bounce' : isAuto ? 'auto_reply' : 'unclear';

    if (dryRun) {
      samples.push({
        messageId,
        from: msg.from,
        subject: msg.subject.slice(0, 80),
        sentiment,
        bounceType,
        staging_id: staging.id,
        matched_how: matchedHow,
      });
      continue;
    }

    // v5: noise (bounces and auto-replies) is inserted with handled_at already set
    // so it never pollutes the unhandled-replies queue. Real replies still arrive
    // as handled_at=null for human/Claude review.
    const isNoise = bounceType !== null || isAuto;
    const noteParts = [
      `Subject: ${msg.subject}`,
      `gmail_id:${messageId}`,
      `matched:${matchedHow}`,
      `labels:${(msg.labelIds || []).join(',')}`,
    ];
    if (bounceType) noteParts.push(`bounce_type:${bounceType}`);

    const { error: insertErr } = await supabase.from('inbound_log').insert({
      staging_id: staging.id,
      attio_record_id: staging.attio_record_id,
      channel: 'email',
      received_at: new Date().toISOString(),
      reply_text: msg.body,
      detected_by: 'gmail-reply-poller',
      sentiment,
      handled_at: isNoise ? new Date().toISOString() : null,
      note: noteParts.join(' | '),
    });

    if (insertErr) continue;
    inserted++;

    if (bounceType === 'hard') {
      bounces_hard++;
      await supabase
        .from('warm_outbound_staging')
        .update({
          delivery_status: 'bounce',
          bounce_type: 'hard',
          delivery_status_at: new Date().toISOString(),
          automation_paused: true,
          automation_paused_reason: 'hard bounce detected by gmail-reply-poller',
        })
        .eq('id', staging.id);
    } else if (bounceType === 'soft') {
      bounces_soft++;
      await supabase
        .from('warm_outbound_staging')
        .update({
          delivery_status: 'soft_bounce',
          bounce_type: 'soft',
          delivery_status_at: new Date().toISOString(),
        })
        .eq('id', staging.id);
    } else if (isAuto) {
      auto_replies++;
      const redirect = extractRedirect(msg.body);
      await supabase
        .from('warm_outbound_staging')
        .update({ archived_at: new Date().toISOString(), archive_reason: 'auto_reply_departed_or_unmonitored' })
        .eq('id', staging.id)
        .is('archived_at', null);

      if (redirect.name || redirect.email) {
        await supabase.from('departed_employee_redirects').insert({
          original_staging_id: staging.id,
          original_full_name: staging.full_name,
          original_company: staging.company,
          redirect_name: redirect.name,
          redirect_email: redirect.email,
          note: `Auto-detected from auto-reply | gmail_id:${messageId}`,
        });
        redirects_logged++;
      }
    } else {
      real_replies++;
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    query: searchQuery,
    found: messageIds.length,
    new: newIds.length,
    inserted,
    real_replies,
    auto_replies,
    bounces_hard,
    bounces_soft,
    redirects_logged,
    skipped_excluded,
    skipped_no_match,
    matched_by_domain,
    samples,
    dry_run: dryRun,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
