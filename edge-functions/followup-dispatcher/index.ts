// followup-dispatcher v3
//
// V3 ADDITIONS:
//   1. SHARED GMAIL DAILY BUDGET: Reads gmail_send_log for today's count.
//      Caps follow-up sends at (GMAIL_HARD_CAP - already_sent_today).
//      First-touch sender uses the same log, so the cap is shared cleanly.
//   2. EARLY ABORT: If today's budget is already exhausted, returns immediately
//      without authenticating Gmail or pulling leads.
//   3. PRIORITY ORDER: Follow-ups sent oldest-due-first (already in v2).
//      v3 also caps the per-run limit at remaining budget so a single run
//      can't consume tomorrow's budget.
//
// V2 GUARDS (preserved): require dispatched_at AND send_message_id present.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ATTIO_API_KEY = Deno.env.get('ATTIO_API_KEY')!;
const GMAIL_CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const GMAIL_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const GMAIL_REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';

const FROM_NAME = 'Jon Nugent';
const FROM_EMAIL = 'jon@complianceworxs.com';
const REPLY_TO = 'jon@complianceworxs.com';
const GMAIL_HARD_CAP_DEFAULT = 100;
const MAX_PER_RUN = 25;
const INTER_SEND_DELAY_MIN_MS = 400;
const INTER_SEND_DELAY_MAX_MS = 1500;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function stageToTouchNumber(stage: string | null): number {
  if (!stage) return 1;
  const m = stage.match(/followup_(\d+)_due/);
  return m ? parseInt(m[1], 10) : 1;
}

function nextStage(touchNumber: number): string {
  return `followup_${touchNumber + 1}_due`;
}

function jitterDelay(): number {
  return INTER_SEND_DELAY_MIN_MS + Math.floor(Math.random() * (INTER_SEND_DELAY_MAX_MS - INTER_SEND_DELAY_MIN_MS));
}

async function getGmailSendsToday(supabase: any): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { count } = await supabase
    .from('gmail_send_log').select('id', { count: 'exact', head: true }).eq('send_date', today);
  return count ?? 0;
}

async function getAccessToken(): Promise<string> {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    throw new Error('gmail_credentials_missing');
  }
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
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`gmail_auth_failed: ${txt.slice(0, 200)}`);
  }
  const data = await r.json();
  if (!data.access_token) throw new Error('gmail_auth_no_access_token');
  return data.access_token;
}

function buildRawEmail(
  toEmail: string, toName: string, subject: string, body: string,
  fromEmail: string, fromName: string, replyTo: string,
  threadReferenceId: string | null
): string {
  const messageId = `<${crypto.randomUUID()}@complianceworxs.com>`;
  const encodedSubject = /[^\x20-\x7E]/.test(subject)
    ? `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`
    : subject;
  const lines = [
    `From: "${fromName}" <${fromEmail}>`,
    `To: "${toName}" <${toEmail}>`,
    `Reply-To: ${replyTo}`,
    `Subject: ${encodedSubject}`,
    `Message-ID: ${messageId}`,
  ];
  if (threadReferenceId) {
    lines.push(`In-Reply-To: ${threadReferenceId}`);
    lines.push(`References: ${threadReferenceId}`);
  }
  lines.push(
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    body,
  );
  const raw = lines.join('\r\n');
  const b64 = btoa(unescape(encodeURIComponent(raw)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendViaGmail(
  accessToken: string,
  toEmail: string, toName: string, subject: string, body: string,
  threadReferenceId: string | null
): Promise<{ ok: boolean; status?: number; error?: string; message_id?: string; thread_id?: string }> {
  try {
    const raw = buildRawEmail(toEmail, toName, subject, body, FROM_EMAIL, FROM_NAME, REPLY_TO, threadReferenceId);
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 300) };
    const json = JSON.parse(text);
    return { ok: true, status: res.status, message_id: json.id, thread_id: json.threadId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function pushAttioNote(personRecordId: string, lead: any, touchNumber: number, subject: string, body: string, messageId: string) {
  const title = `FOLLOW-UP #${touchNumber} SENT: ${subject}`;
  const content = [
    `Status: SENT via Gmail API (follow-up touch ${touchNumber} of 7)`,
    `Gmail Message ID: ${messageId}`,
    `Sent: ${new Date().toISOString()}`,
    `From: ${FROM_NAME} <${FROM_EMAIL}>`,
    `To: ${lead.full_name} <${lead.email}>`,
    ``,
    `--- SUBJECT ---`, subject, ``, `--- BODY ---`, body,
  ].join('\n');
  try {
    await fetch('https://api.attio.com/v2/notes', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ATTIO_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          parent_object: 'people',
          parent_record_id: personRecordId,
          title: title.slice(0, 200),
          format: 'plaintext',
          content: content.slice(0, 9000),
        }
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {}
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === '1';
  const limitParam = parseInt(url.searchParams.get('limit') || '', 10);
  const requestedLimit = !isNaN(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_PER_RUN) : MAX_PER_RUN;

  // V3: SHARED GMAIL BUDGET CHECK
  const envHardCap = parseInt(Deno.env.get('GMAIL_DAILY_CAP') || '', 10);
  const GMAIL_HARD_CAP = !isNaN(envHardCap) ? envHardCap : GMAIL_HARD_CAP_DEFAULT;

  const gmailSentToday = await getGmailSendsToday(supabase);
  const gmailRemaining = Math.max(0, GMAIL_HARD_CAP - gmailSentToday);

  if (gmailRemaining <= 0) {
    return new Response(JSON.stringify({
      ok: true,
      summary: `⏸ Daily Gmail cap reached (${gmailSentToday}/${GMAIL_HARD_CAP}). Follow-up sends paused until tomorrow.`,
      sent: 0,
      gmail_sent_today: gmailSentToday,
      gmail_hard_cap: GMAIL_HARD_CAP,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Cap this run at min(requestedLimit, remainingBudget)
  const effectiveLimit = Math.min(requestedLimit, gmailRemaining);

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const { data: cadenceRows } = await supabase
    .from('outbound_followup_cadence')
    .select('touch_number, days_after_previous, angle')
    .eq('active', true)
    .order('touch_number');

  const cadenceMap = new Map<number, any>();
  (cadenceRows || []).forEach(r => cadenceMap.set(r.touch_number, r));

  const { data: leads, error } = await supabase
    .from('warm_outbound_staging')
    .select('id, full_name, email, job_title, company, industry, fit_score, attio_record_id, send_message_id, sequence_email_count, followup_stage, followup_drafts, next_followup_due_at, dispatched_at')
    .lte('next_followup_due_at', new Date().toISOString())
    .is('replied_at', null)
    .eq('automation_paused', false)
    .is('archived_at', null)
    .is('followup_completed_at', null)
    .eq('is_paying_customer', false)
    .not('dispatched_at', 'is', null)
    .not('send_message_id', 'is', null)
    .order('next_followup_due_at', { ascending: true })
    .limit(effectiveLimit);

  if (error) {
    return new Response(JSON.stringify({ error: 'fetch_failed', detail: error.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (!leads?.length) {
    return new Response(JSON.stringify({
      ok: true,
      summary: 'No follow-ups due for sending.',
      sent: 0,
      gmail_sent_today: gmailSentToday,
      gmail_remaining: gmailRemaining,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  let sent = 0, skipped = 0, failed = 0, completed = 0;
  const results: any[] = [];

  for (const lead of leads) {
    try {
      const touchNumber = stageToTouchNumber(lead.followup_stage);
      const drafts = Array.isArray(lead.followup_drafts) ? lead.followup_drafts : [];
      const targetDraft = drafts.find((d: any) => d.touch_number === touchNumber && d.status === 'drafted');

      if (!targetDraft) {
        skipped++;
        results.push({ id: lead.id, name: lead.full_name, status: 'skipped', reason: `no_drafted_body_for_touch_${touchNumber}` });
        continue;
      }

      if (dryRun) {
        results.push({ id: lead.id, name: lead.full_name, status: 'dry_run', touch_number: touchNumber });
        continue;
      }

      const threadRef = lead.send_message_id ? `<${lead.send_message_id}@mail.gmail.com>` : null;

      const result = await sendViaGmail(
        accessToken, lead.email, lead.full_name,
        targetDraft.subject, targetDraft.body, threadRef
      );

      if (!result.ok) {
        failed++;
        results.push({
          id: lead.id, name: lead.full_name, status: 'send_failed',
          http_status: result.status, error: result.error?.slice(0, 200),
        });
        continue;
      }

      const updatedDrafts = drafts.map((d: any) =>
        d.touch_number === touchNumber
          ? { ...d, sent_at: new Date().toISOString(), message_id: result.message_id, status: 'sent' }
          : d
      );

      const newSequenceCount = (lead.sequence_email_count ?? 0) + 1;
      const isFinalTouch = touchNumber >= 7;
      const nextCadence = cadenceMap.get(touchNumber + 1);

      const updateFields: any = {
        followup_drafts: updatedDrafts,
        sequence_email_count: newSequenceCount,
        last_sequence_email_at: new Date().toISOString(),
      };

      if (isFinalTouch || !nextCadence) {
        updateFields.followup_completed_at = new Date().toISOString();
        updateFields.followup_stage = 'completed';
        updateFields.next_followup_due_at = null;
        completed++;
      } else {
        const nextDueDays = nextCadence.days_after_previous;
        const nextDueAt = new Date(Date.now() + nextDueDays * 86400000).toISOString();
        updateFields.followup_stage = nextStage(touchNumber);
        updateFields.next_followup_due_at = nextDueAt;
      }

      const { error: updErr } = await supabase
        .from('warm_outbound_staging')
        .update(updateFields)
        .eq('id', lead.id);

      if (updErr) {
        failed++;
        results.push({ id: lead.id, name: lead.full_name, status: 'update_after_send_failed', error: updErr.message });
        continue;
      }

      try {
        await supabase.from('gmail_send_log').insert({
          staging_id: lead.id,
          recipient_email: lead.email,
          gmail_message_id: result.message_id || null,
          gmail_thread_id: result.thread_id || null,
          http_status: result.status || 200,
          send_kind: `followup_${touchNumber}`,
          nurture_touch_number: touchNumber,
        });
      } catch {}

      if (lead.attio_record_id) {
        await pushAttioNote(lead.attio_record_id, lead, touchNumber, targetDraft.subject, targetDraft.body, result.message_id || 'unknown');
      }

      sent++;
      results.push({
        id: lead.id, name: lead.full_name, company: lead.company,
        status: 'sent', touch_number: touchNumber,
        is_final: isFinalTouch,
        message_id: result.message_id,
      });
      await new Promise(r => setTimeout(r, jitterDelay()));
    } catch (e) {
      failed++;
      results.push({ id: lead.id, name: lead.full_name, status: 'exception', error: (e as Error).message.slice(0, 200) });
    }
  }

  return new Response(JSON.stringify({
    ok: failed === 0,
    summary: `Sent ${sent} | Completed sequence ${completed} | Skipped ${skipped} | Failed ${failed} | Gmail today ${gmailSentToday + sent}/${GMAIL_HARD_CAP}`,
    sent, completed, skipped, failed, eligible: leads.length,
    gmail_sent_today_before: gmailSentToday,
    gmail_sent_today_after: gmailSentToday + sent,
    gmail_hard_cap: GMAIL_HARD_CAP,
    results,
  }, null, 2), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
