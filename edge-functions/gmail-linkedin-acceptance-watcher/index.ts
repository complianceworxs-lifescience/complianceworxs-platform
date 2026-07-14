// gmail-linkedin-acceptance-watcher v2 — May 4 2026
// V2 CHANGE: drops Gmail label tracking (current OAuth scopes don't include
// label modify). Tracks processed thread IDs in linkedin_acceptance_log table
// instead. Same effect, no re-auth required.
//
// Polls Gmail for forwarded LinkedIn 'accepted your invitation' emails,
// hands each unprocessed thread to linkedin-acceptance-handler.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GMAIL_CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const GMAIL_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const GMAIL_REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';
const ADMIN_SECRET = Deno.env.get('PHANTOMBUSTER_WEBHOOK_SECRET') ?? '';
const HANDLER_URL = `${SUPABASE_URL}/functions/v1/linkedin-acceptance-handler?secret=${ADMIN_SECRET}`;

const SEARCH_QUERY = 'from:(linkedin.com) subject:("accepted your invitation") newer_than:7d';

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

async function searchThreads(token: string): Promise<string[]> {
  try {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(SEARCH_QUERY)}&maxResults=20`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.threads || []).map((t: any) => t.id);
  } catch { return []; }
}

async function getThreadFirstMessage(token: string, threadId: string): Promise<{ subject: string; from: string; body: string } | null> {
  try {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const msg = j.messages?.[0];
    if (!msg) return null;
    const headers = msg.payload?.headers || [];
    const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '';
    const from = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || '';
    let body = '';
    function walk(part: any) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body += atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
      }
      if (part.parts) part.parts.forEach(walk);
    }
    if (msg.payload) walk(msg.payload);
    return { subject, from, body: body.slice(0, 5000) };
  } catch { return null; }
}

async function callHandler(subject: string, from: string, body: string): Promise<any> {
  try {
    const r = await fetch(HANDLER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, from, body }),
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    try { return JSON.parse(text); } catch { return { raw: text.slice(0, 200) }; }
  } catch (e) {
    return { error: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === '1';

  const token = await getAccessToken();
  if (!token) {
    return new Response(JSON.stringify({
      ok: false, error: 'gmail_auth_failed',
      hint: 'Same OAuth flow as outbound-sender-gmail. Check GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN env vars.',
    }, null, 2), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }

  // Fetch already-processed thread IDs from log
  const { data: processedRows } = await supabase
    .from('linkedin_acceptance_log')
    .select('thread_id')
    .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString());
  const processedSet = new Set((processedRows || []).map((r: any) => r.thread_id));

  const threadIds = await searchThreads(token);
  const newThreadIds = threadIds.filter(id => !processedSet.has(id));

  const results: any[] = [];
  let processed = 0, skipped = 0, failed = 0;

  for (const threadId of newThreadIds) {
    const msg = await getThreadFirstMessage(token, threadId);
    if (!msg) { skipped++; results.push({ thread_id: threadId, status: 'fetch_failed' }); continue; }

    if (dryRun) {
      results.push({ thread_id: threadId, status: 'dry_run', subject: msg.subject, from: msg.from });
      processed++;
      continue;
    }

    const handlerResult = await callHandler(msg.subject, msg.from, msg.body);

    if (handlerResult.ok) processed++;
    else if (handlerResult.error) failed++;
    else skipped++;

    results.push({
      thread_id: threadId,
      subject: msg.subject.slice(0, 100),
      handler: handlerResult,
    });

    // Always log so we don't reprocess on next cron tick
    try {
      await supabase.from('linkedin_acceptance_log').insert({
        thread_id: threadId,
        subject: msg.subject.slice(0, 500),
        from_addr: msg.from.slice(0, 200),
        handler_response: handlerResult,
        labeled_processed: true,
      });
    } catch {}
  }

  return new Response(JSON.stringify({
    ok: true,
    threads_found_total: threadIds.length,
    threads_already_processed: threadIds.length - newThreadIds.length,
    threads_new: newThreadIds.length,
    processed, skipped, failed,
    results,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
