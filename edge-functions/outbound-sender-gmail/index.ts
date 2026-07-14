// outbound-sender-gmail v6 — May 19 2026 — CADENCE TRIGGER FIX
//
// v5 → v6 CHANGES:
//   1. After successful send, sets sequence_email_count = 1 AND
//      last_sequence_email_at = now(). Previously only set dispatched_at,
//      which left calculate_next_followup() trigger dormant — stage stayed
//      null forever and followup-drafter never picked the lead up. The
//      audit caught 11 orphans from this bug; backfilled separately.
//   2. Updated audit alert prefix in writeAlert calls remains 'outbound-sender-gmail'
//      — outbound-health-audit owns audit_check_*, throughput_collapse, etc.
//
// EVERYTHING ELSE FROM v5: v29-silenced lead filtering, credential
// integrity check, audience verification, self-documenting auth errors,
// state awareness, format validation, transient error handling,
// gmail_send_log hard cap, per-lead try/catch, system_alerts on critical failures.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ATTIO_API_KEY = Deno.env.get('ATTIO_API_KEY')!;
const GMAIL_CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const GMAIL_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const GMAIL_REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';
const GCP_PROJECT_ID = Deno.env.get('GCP_PROJECT_ID') ?? 'compliance-dashboard-79b41';
const ADMIN_SECRET = Deno.env.get('PHANTOMBUSTER_WEBHOOK_SECRET') ?? '';

const FROM_NAME = 'Jon Nugent';
const FROM_EMAIL = 'jon@complianceworxs.com';
const REPLY_TO = 'jon@complianceworxs.com';
const GMAIL_HARD_CAP_DEFAULT = 100;
const MAX_PER_DOMAIN_PER_WEEK = 1;
const MAX_RETRIES = 3;
const INTER_SEND_DELAY_MIN_MS = 400;
const INTER_SEND_DELAY_MAX_MS = 1500;
const TOKEN_AGE_WARN_DAYS = 150;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function gcpConsoleUrl() {
  return `https://console.cloud.google.com/auth/clients?project=${GCP_PROJECT_ID}`;
}

function credentialDiagnostics() {
  return {
    client_id_prefix: GMAIL_CLIENT_ID.slice(0, 16) || 'MISSING',
    client_secret_present: !!GMAIL_CLIENT_SECRET,
    refresh_token_present: !!GMAIL_REFRESH_TOKEN,
    refresh_token_prefix: GMAIL_REFRESH_TOKEN.slice(0, 8) || 'MISSING',
    gcp_console_url: gcpConsoleUrl(),
  };
}

async function writeAlert(supabase: any, alertType: string, severity: string, message: string, context: any = {}) {
  try {
    await supabase.from('system_alerts').insert({
      alert_type: alertType,
      severity,
      source: 'outbound-sender-gmail',
      message,
      context: { ...context, credentials: credentialDiagnostics() },
    });
  } catch (e) {
    console.error('[outbound-sender-gmail] alert write failed', (e as Error).message);
  }
}

async function logAuthState(supabase: any, fields: any) {
  try {
    await supabase.from('gmail_auth_state').insert(fields);
  } catch (e) {
    console.error('[outbound-sender-gmail] auth state log failed', (e as Error).message);
  }
}

async function lastSuccessfulAuth(supabase: any): Promise<{ ts: string | null; days_ago: number | null }> {
  const { data } = await supabase
    .from('gmail_auth_state')
    .select('checked_at')
    .eq('refresh_succeeded', true)
    .order('checked_at', { ascending: false }).limit(1).maybeSingle();
  if (!data?.checked_at) return { ts: null, days_ago: null };
  const days = Math.floor((Date.now() - new Date(data.checked_at).getTime()) / 86400000);
  return { ts: data.checked_at, days_ago: days };
}

function isValidEmailFormat(email: string | null | undefined): boolean {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  const re = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
  if (!re.test(trimmed)) return false;
  if (/\.{2,}/.test(trimmed)) return false;
  if (/^\.|\.@|@\./.test(trimmed)) return false;
  return true;
}

function jitterDelay(): number {
  return INTER_SEND_DELAY_MIN_MS + Math.floor(Math.random() * (INTER_SEND_DELAY_MAX_MS - INTER_SEND_DELAY_MIN_MS));
}

async function getAccessTokenWithIntegrityCheck(supabase: any): Promise<{
  ok: boolean;
  access_token?: string;
  abort_reason?: string;
  http_response: any;
}> {
  const creds = credentialDiagnostics();

  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    const missing: string[] = [];
    if (!GMAIL_CLIENT_ID) missing.push('GMAIL_CLIENT_ID');
    if (!GMAIL_CLIENT_SECRET) missing.push('GMAIL_CLIENT_SECRET');
    if (!GMAIL_REFRESH_TOKEN) missing.push('GMAIL_REFRESH_TOKEN');

    await logAuthState(supabase, {
      client_id_prefix: creds.client_id_prefix,
      refresh_token_prefix: creds.refresh_token_prefix,
      refresh_status: 0,
      refresh_succeeded: false,
      error_message: `missing_secrets: ${missing.join(', ')}`,
    });

    await writeAlert(supabase, 'gmail_credentials_missing', 'critical',
      `Missing required Supabase secrets: ${missing.join(', ')}. Cannot authenticate to Gmail.`,
      { missing }
    );

    return {
      ok: false,
      abort_reason: 'credentials_missing',
      http_response: {
        error: 'gmail_credentials_missing',
        missing_secrets: missing,
        diagnostics: creds,
        suggested_action: missing.includes('GMAIL_REFRESH_TOKEN')
          ? `Run OAuth Playground flow against Client ID ${creds.client_id_prefix}... and paste resulting refresh_token into Supabase secret GMAIL_REFRESH_TOKEN. See: ${creds.gcp_console_url}`
          : `Set missing secrets in Supabase Edge Functions config and redeploy.`,
      },
    };
  }

  let refreshStatus = 0;
  let refreshBody = '';
  let accessToken: string | null = null;
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
    refreshStatus = r.status;
    refreshBody = await r.text();
    if (r.ok) {
      try { accessToken = JSON.parse(refreshBody).access_token; } catch {}
    }
  } catch (e) {
    refreshBody = `network_exception: ${(e as Error).message}`;
  }

  if (!accessToken) {
    let googleError = '';
    let suggestedAction = '';
    try {
      const parsed = JSON.parse(refreshBody);
      googleError = parsed.error || 'unknown';
      const errDesc = parsed.error_description || '';
      if (googleError === 'invalid_client') {
        suggestedAction = `Client ID + Client Secret pair is invalid. Verify both are from the SAME OAuth client in ${creds.gcp_console_url}. Current Client ID prefix: ${creds.client_id_prefix}`;
      } else if (googleError === 'invalid_grant') {
        suggestedAction = `Refresh token rejected. Likely causes: (1) token was revoked, (2) token belongs to a different OAuth client than current GMAIL_CLIENT_ID (${creds.client_id_prefix}...), (3) token expired due to 6mo inactivity. Re-run OAuth Playground flow.`;
      } else if (errDesc.includes('refresh_token')) {
        suggestedAction = `Refresh token issue: ${errDesc}. Re-authorize via OAuth Playground.`;
      } else {
        suggestedAction = `Unexpected error: ${errDesc}. Check ${creds.gcp_console_url}`;
      }
    } catch {
      suggestedAction = `Unparseable response from Google. Body: ${refreshBody.slice(0, 200)}`;
    }

    const lastOk = await lastSuccessfulAuth(supabase);

    await logAuthState(supabase, {
      client_id_prefix: creds.client_id_prefix,
      refresh_token_prefix: creds.refresh_token_prefix,
      refresh_status: refreshStatus,
      refresh_succeeded: false,
      error_message: refreshBody.slice(0, 500),
    });

    await writeAlert(supabase, 'gmail_oauth_refresh_failed', 'critical',
      `Gmail token refresh failed: ${googleError || refreshStatus}`,
      { google_error: googleError, body: refreshBody.slice(0, 300), last_successful_auth: lastOk }
    );

    return {
      ok: false,
      abort_reason: 'refresh_failed',
      http_response: {
        error: 'gmail_oauth_refresh_failed',
        google_error: googleError,
        google_response: refreshBody.slice(0, 300),
        diagnostics: creds,
        last_successful_auth_at: lastOk.ts,
        last_successful_auth_days_ago: lastOk.days_ago,
        suggested_action: suggestedAction,
      },
    };
  }

  let audience: string | null = null;
  let scope: string | null = null;
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`,
      { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const info = await r.json();
      audience = info.aud || info.audience || null;
      scope = info.scope || null;
    }
  } catch {}

  const audienceMatches = audience === GMAIL_CLIENT_ID;

  await logAuthState(supabase, {
    client_id_prefix: creds.client_id_prefix,
    refresh_token_prefix: creds.refresh_token_prefix,
    refresh_status: refreshStatus,
    refresh_succeeded: true,
    audience_from_token: audience,
    audience_matches_env: audienceMatches,
    scope_returned: scope,
  });

  if (audience && !audienceMatches) {
    await writeAlert(supabase, 'gmail_credential_drift_detected', 'critical',
      'Mismatched OAuth Client detected: refresh token was issued for a different client than current GMAIL_CLIENT_ID',
      {
        env_client_id: GMAIL_CLIENT_ID,
        token_audience: audience,
        action_required: `Update GMAIL_CLIENT_ID to ${audience} OR re-authorize against current Client ID ${GMAIL_CLIENT_ID}`,
      }
    );
    return {
      ok: false,
      abort_reason: 'credential_drift',
      http_response: {
        error: 'mismatched_oauth_client',
        message: 'Mismatched OAuth Client detected',
        env_client_id: GMAIL_CLIENT_ID,
        token_was_issued_for: audience,
        diagnostics: creds,
        suggested_action: `Refresh token belongs to client ${audience} but GMAIL_CLIENT_ID is ${GMAIL_CLIENT_ID}. Either update GMAIL_CLIENT_ID to ${audience} (and matching client_secret) OR re-run OAuth Playground against ${GMAIL_CLIENT_ID}.`,
      },
    };
  }

  const lastOk = await lastSuccessfulAuth(supabase);
  if (lastOk.days_ago !== null && lastOk.days_ago > TOKEN_AGE_WARN_DAYS) {
    await writeAlert(supabase, 'gmail_token_aging', 'warning',
      `Refresh token last successfully used ${lastOk.days_ago} days ago. Google revokes tokens after 180 days of inactivity. Plan re-authorization.`,
      { last_successful_auth_at: lastOk.ts, days_ago: lastOk.days_ago }
    );
  }

  return { ok: true, access_token: accessToken, http_response: null };
}

function buildRawEmail(
  toEmail: string, toName: string, subject: string, body: string,
  fromEmail: string, fromName: string, replyTo: string
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
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    body,
  ];
  const raw = lines.join('\r\n');
  const b64 = btoa(unescape(encodeURIComponent(raw)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendViaGmail(
  accessToken: string,
  toEmail: string, toName: string, subject: string, body: string
): Promise<{ ok: boolean; status?: number; error?: string; message_id?: string; thread_id?: string }> {
  try {
    const raw = buildRawEmail(toEmail, toName, subject, body, FROM_EMAIL, FROM_NAME, REPLY_TO);
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

function isTransientError(status: number | undefined): boolean {
  if (!status) return true;
  if (status === 429 || status === 401 || status === 403) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

async function getInternalBudget(supabase: any) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('outbound_send_budget_schedule')
    .select('effective_date, daily_budget, notes')
    .lte('effective_date', today)
    .order('effective_date', { ascending: false }).limit(1).maybeSingle();
  return data || { daily_budget: 25, notes: 'fallback' };
}

async function getGmailSendsToday(supabase: any): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { count } = await supabase
    .from('gmail_send_log').select('id', { count: 'exact', head: true }).eq('send_date', today);
  return count ?? 0;
}

async function logGmailSend(supabase: any, lead: any, result: any) {
  try {
    await supabase.from('gmail_send_log').insert({
      staging_id: lead.id,
      recipient_email: lead.email,
      gmail_message_id: result.message_id || null,
      gmail_thread_id: result.thread_id || null,
      http_status: result.status || 200,
    });
  } catch (e) {
    console.error('[outbound-sender-gmail] gmail_send_log failed', (e as Error).message);
  }
}

async function isSuppressed(supabase: any, email: string, domain: string | null) {
  const { data: emailSup } = await supabase
    .from('outbound_suppressions').select('reason').ilike('email', email).limit(1).maybeSingle();
  if (emailSup) return { suppressed: true, reason: `email_${emailSup.reason}` };
  if (domain) {
    const { data: domainSup } = await supabase
      .from('outbound_suppressions').select('reason').eq('domain', domain).is('email', null).limit(1).maybeSingle();
    if (domainSup) return { suppressed: true, reason: `domain_${domainSup.reason}` };
  }
  return { suppressed: false };
}

async function checkDomainThrottle(supabase: any, domain: string | null): Promise<boolean> {
  if (!domain) return true;
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { count } = await supabase
    .from('warm_outbound_staging').select('id', { count: 'exact', head: true })
    .eq('company_domain', domain).in('send_provider', ['gmail', 'resend']).gte('dispatched_at', since);
  return (count ?? 0) < MAX_PER_DOMAIN_PER_WEEK;
}

async function pushSentNote(personRecordId: string, lead: any, subject: string, body: string, messageId: string, threadId: string) {
  const title = `SENT (Gmail): ${subject}`;
  const content = [
    `Status: SENT via Gmail API`, `Gmail Message ID: ${messageId}`, `Gmail Thread ID: ${threadId}`,
    `Sent: ${new Date().toISOString()}`,
    `From: ${FROM_NAME} <${FROM_EMAIL}>`, `Reply-To: ${REPLY_TO}`,
    `To: ${lead.full_name} <${lead.email}>`,
    `Industry: ${lead.industry} | Fit: ${lead.fit_score}/100`, ``,
    `--- SUBJECT ---`, subject, ``, `--- BODY ---`, body,
  ].join('\n');
  try {
    await fetch('https://api.attio.com/v2/notes', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ATTIO_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { parent_object: 'people', parent_record_id: personRecordId, title: title.slice(0, 200), format: 'plaintext', content: content.slice(0, 9000) } }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {}
}

async function getSilencedTodayCount(supabase: any): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { count } = await supabase.from('warm_outbound_staging')
    .select('id', { count: 'exact', head: true })
    .eq('outbound_action', 'no_note_connect_only')
    .gte('first_touch_drafted_at', `${today}T00:00:00Z`);
  return count ?? 0;
}

function buildSummary(stats: any): string {
  const lines = [
    `=== OUTBOUND SEND SUMMARY ===`,
    `Provider: Gmail (jon@complianceworxs.com)`,
    `Eligible leads pulled: ${stats.eligible}`,
    `✅ Sent: ${stats.sent}`,
    `⚠ Throttled (per-domain weekly cap): ${stats.throttled}`,
    `🚫 Suppressed (bounce/complaint): ${stats.suppressed}`,
    `❌ Hard failed: ${stats.failed}`,
    `⏳ Transient (will retry): ${stats.transient}`,
    `🚫 Invalid email format: ${stats.invalid}`,
    `🔇 v29 silenced today (routed to manual LinkedIn no-note): ${stats.silenced_today}`,
    `Gmail sent today (running total): ${stats.gmail_sent_today_after}/${stats.gmail_hard_cap}`,
  ];
  if (stats.aborted) lines.push(`🛑 BATCH ABORTED: ${stats.abort_reason}`);
  if (stats.action_recommended) lines.push(``, `ACTION: ${stats.action_recommended}`);
  return lines.join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const forceId = url.searchParams.get('force_id');
  const isAdmin = url.searchParams.get('secret') === ADMIN_SECRET;
  const dryRun = url.searchParams.get('dry_run') === '1';

  const envHardCap = parseInt(Deno.env.get('GMAIL_DAILY_CAP') || '', 10);
  const queryHardCap = isAdmin ? parseInt(url.searchParams.get('hard_cap') || '', 10) : NaN;
  const GMAIL_HARD_CAP = !isNaN(queryHardCap) ? queryHardCap
                       : !isNaN(envHardCap) ? envHardCap
                       : GMAIL_HARD_CAP_DEFAULT;

  const auth = await getAccessTokenWithIntegrityCheck(supabase);
  if (!auth.ok) {
    return new Response(JSON.stringify({
      ok: false,
      summary: `🛑 Auth aborted: ${auth.abort_reason}. See diagnostics.`,
      ...auth.http_response,
    }, null, 2), {
      status: 503,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  const accessToken = auth.access_token!;

  const gmailSentToday = await getGmailSendsToday(supabase);
  const gmailRemaining = GMAIL_HARD_CAP - gmailSentToday;
  const silencedToday = await getSilencedTodayCount(supabase);

  if (gmailRemaining <= 0 && !forceId) {
    await writeAlert(supabase, 'gmail_daily_cap_reached', 'info',
      `Gmail hard cap of ${GMAIL_HARD_CAP} reached for today.`,
      { sent_today: gmailSentToday, cap: GMAIL_HARD_CAP }
    );
    return new Response(JSON.stringify({
      ok: true,
      summary: `⏸ Daily Gmail cap reached (${gmailSentToday}/${GMAIL_HARD_CAP}). No sends until tomorrow. v29 silenced: ${silencedToday}.`,
      sent: 0, gmail_sent_today: gmailSentToday, gmail_hard_cap: GMAIL_HARD_CAP, silenced_today: silencedToday,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const internalBudget = await getInternalBudget(supabase);
  const effectiveLimit = Math.min(gmailRemaining, internalBudget.daily_budget);

  let q = supabase.from('warm_outbound_staging')
    .select('id, full_name, email, job_title, company, company_domain, attio_record_id, industry, fit_score, first_touch_draft_subject, first_touch_draft_body, send_attempts, outbound_action')
    .eq('email_approved', true).eq('is_paying_customer', false).eq('automation_paused', false)
    .is('dispatched_at', null).not('first_touch_draft_body', 'is', null).not('email', 'is', null)
    .or('outbound_action.is.null,outbound_action.neq.no_note_connect_only')
    .lt('send_attempts', MAX_RETRIES);

  if (forceId && isAdmin) {
    q = supabase.from('warm_outbound_staging')
      .select('id, full_name, email, job_title, company, company_domain, attio_record_id, industry, fit_score, first_touch_draft_subject, first_touch_draft_body, send_attempts, outbound_action')
      .eq('id', parseInt(forceId, 10));
  }
  q = q.order('email_approved_at', { ascending: true, nullsFirst: false }).limit(Math.max(effectiveLimit, 1));

  const { data: leads, error } = await q;
  if (error) return new Response(JSON.stringify({ error: 'fetch_failed', detail: error.message }),
    { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (!leads?.length) {
    return new Response(JSON.stringify({
      ok: true,
      summary: `No approved sends pending. Gmail budget remaining today: ${gmailRemaining}. v29 silenced today: ${silencedToday}.`,
      sent: 0, gmail_remaining: gmailRemaining, silenced_today: silencedToday,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  let sent = 0, throttled = 0, suppressed = 0, failed = 0, transient = 0, invalid = 0;
  const results: any[] = [];
  let abortBatch = false;
  let abortReason: string | null = null;

  for (const lead of leads) {
    if (abortBatch) {
      results.push({ id: lead.id, name: lead.full_name, status: 'skipped', reason: abortReason });
      continue;
    }

    try {
      if (lead.outbound_action === 'no_note_connect_only') {
        results.push({ id: lead.id, name: lead.full_name, status: 'silenced_skipped', reason: 'v29_no_signal' });
        continue;
      }

      if (!isValidEmailFormat(lead.email)) {
        invalid++;
        await supabase.from('warm_outbound_staging').update({
          dispatched_at: new Date().toISOString(),
          send_provider: 'invalid_format',
          send_error: `invalid_email_format: ${(lead.email || '').slice(0, 100)}`,
          send_attempts: MAX_RETRIES,
        }).eq('id', lead.id);
        results.push({ id: lead.id, name: lead.full_name, status: 'invalid_format', email: lead.email });
        continue;
      }

      const sup = await isSuppressed(supabase, lead.email, lead.company_domain);
      if (sup.suppressed) {
        suppressed++;
        await supabase.from('warm_outbound_staging').update({
          dispatched_at: new Date().toISOString(),
          send_provider: 'suppressed',
          send_error: `suppressed: ${sup.reason}`,
        }).eq('id', lead.id);
        results.push({ id: lead.id, name: lead.full_name, status: 'suppressed', reason: sup.reason });
        continue;
      }

      const allowed = await checkDomainThrottle(supabase, lead.company_domain);
      if (!allowed) {
        throttled++;
        results.push({ id: lead.id, name: lead.full_name, status: 'throttled', reason: 'domain_weekly_limit' });
        continue;
      }

      if (dryRun) {
        results.push({ id: lead.id, name: lead.full_name, status: 'dry_run_would_send', email: lead.email });
        continue;
      }

      const result = await sendViaGmail(
        accessToken, lead.email, lead.full_name,
        lead.first_touch_draft_subject, lead.first_touch_draft_body
      );

      if (!result.ok) {
        const isTransient = isTransientError(result.status);
        const isAuthFail = result.status === 401 || result.status === 403;
        const isQuotaHit = result.status === 429;

        const updateFields: any = {
          send_error: `gmail_${result.status || 0}: ${result.error?.slice(0, 500)}`,
        };
        if (!isTransient) {
          updateFields.send_attempts = (lead.send_attempts ?? 0) + 1;
          failed++;
        } else {
          transient++;
        }
        await supabase.from('warm_outbound_staging').update(updateFields).eq('id', lead.id);
        results.push({ id: lead.id, name: lead.full_name, status: 'failed', transient: isTransient, http_status: result.status, error: result.error?.slice(0, 200) });

        if (isAuthFail) {
          await writeAlert(supabase, 'gmail_send_auth_failed', 'critical',
            'Gmail send returned 401/403 mid-batch. Token revoked or scope removed.',
            { http_status: result.status, error: result.error?.slice(0, 200), staging_id: lead.id }
          );
          abortBatch = true; abortReason = 'gmail_auth_failed_mid_batch'; continue;
        }
        if (isQuotaHit) {
          await writeAlert(supabase, 'gmail_quota_hit', 'critical',
            'Gmail returned 429. Batch aborted.',
            { sent_in_batch: sent, sent_today: gmailSentToday + sent }
          );
          abortBatch = true; abortReason = 'gmail_quota_hit_mid_batch'; continue;
        }
        await new Promise(r => setTimeout(r, jitterDelay()));
        continue;
      }

      // v6: set sequence_email_count = 1 AND last_sequence_email_at = now()
      // so calculate_next_followup() trigger fires and assigns followup_2_due
      // stage with proper next_followup_due_at. Without these fields the
      // cadence engine never advances the lead.
      const sendTime = new Date().toISOString();
      await supabase.from('warm_outbound_staging').update({
        dispatched_at: sendTime,
        send_provider: 'gmail',
        send_message_id: result.message_id,
        send_attempts: (lead.send_attempts ?? 0) + 1,
        send_error: null,
        delivery_status: 'sent',
        delivery_status_at: sendTime,
        sequence_email_count: 1,
        last_sequence_email_at: sendTime,
      }).eq('id', lead.id);

      await logGmailSend(supabase, lead, result);

      if (lead.attio_record_id) {
        await pushSentNote(lead.attio_record_id, lead, lead.first_touch_draft_subject, lead.first_touch_draft_body, result.message_id || 'unknown', result.thread_id || 'unknown');
      }

      sent++;
      results.push({ id: lead.id, name: lead.full_name, company: lead.company, fit: lead.fit_score, status: 'sent', message_id: result.message_id });
      await new Promise(r => setTimeout(r, jitterDelay()));
    } catch (e) {
      failed++;
      await supabase.from('warm_outbound_staging').update({
        send_error: `unexpected_exception: ${(e as Error).message.slice(0, 500)}`,
      }).eq('id', lead.id);
      results.push({ id: lead.id, name: lead.full_name, status: 'exception', error: (e as Error).message.slice(0, 200) });
    }
  }

  let action_recommended: string | null = null;
  if (abortBatch && abortReason === 'gmail_auth_failed_mid_batch') {
    action_recommended = `Re-authorize Gmail OAuth via Playground. Check ${gcpConsoleUrl()}.`;
  } else if (abortBatch && abortReason === 'gmail_quota_hit_mid_batch') {
    action_recommended = `Gmail rate-limited. Reduce GMAIL_DAILY_CAP and resume tomorrow.`;
  } else if (failed > 0 && transient === 0) {
    action_recommended = `${failed} hard failures. Inspect send_error column on warm_outbound_staging.`;
  } else if (sent === 0 && leads.length > 0) {
    action_recommended = `${leads.length} leads pulled but 0 sent. Check throttle/suppression logic.`;
  }

  const stats = {
    eligible: leads.length, sent, throttled, suppressed, failed, transient, invalid,
    silenced_today: silencedToday,
    aborted: abortBatch, abort_reason: abortReason,
    gmail_hard_cap: GMAIL_HARD_CAP,
    gmail_sent_today_before: gmailSentToday,
    gmail_sent_today_after: gmailSentToday + sent,
    action_recommended,
  };

  return new Response(JSON.stringify({
    ok: failed === 0 && !abortBatch,
    summary: buildSummary(stats),
    provider: 'gmail',
    ...stats,
    results,
  }, null, 2), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
