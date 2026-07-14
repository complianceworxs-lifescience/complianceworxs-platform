// daily-brief-generator v25 — May 7 2026
// CHANGES from v24:
//   - REVENUE PROGRESS line at top of brief (May target $1,500, MTD, days remaining,
//     run-rate projection)
//   - DM CHANNEL DEAD alert when 7-day DM volume is zero
//   - INSPECTOR-ANGLE COVERAGE GAP alert when followups_due rows are missing
//     research (silently degrades today's email #2)
//   - All three surface as TOP-OF-BRIEF alerts before the topline table

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ATTIO_API_KEY = Deno.env.get('ATTIO_API_KEY') ?? '';
const GMAIL_CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const GMAIL_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const GMAIL_REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';
const BRIEF_RECIPIENT = 'jon@complianceworxs.com';
const BRIEF_FROM_NAME = 'CW Daily Brief';
const BRIEF_FROM_EMAIL = 'jon@complianceworxs.com';

// Revenue target config
const MAY_TARGET_DOLLARS = 1500;
const MAY_START_ISO = '2026-05-01T00:00:00.000Z';
const MAY_END_ISO = '2026-05-31T23:59:59.999Z';

const NON_FDA_DOMAIN_PATTERNS = [
  /consult/i, /coaching/i, /coach\./i, /advisor/i, /agency/i, /staffing/i,
  /recruit/i, /marketing/i, /capital/i, /ventures/i, /equity/i, /partners/i,
  /dropinceo/i, /associates/i, /\.law\./i, /accounting/i, /finance/i,
];
const NON_BUYER_TITLE_PATTERNS = [
  /coach/i, /advisor/i, /investor/i, /broker/i, /realtor/i,
  /sales/i, /marketing/i, /recruiter/i, /talent/i, /hr\b/i, /human resources/i,
  /accountant/i, /lawyer/i, /attorney/i,
];
const FDA_INDUSTRY_KEYWORDS = [
  'pharma', 'biotech', 'biolog', 'therapeutic', 'oncology', 'medical', 'medtech',
  'device', 'diagnostic', 'clinical', 'gmp', 'cgmp', 'lifescience', 'life-science',
  'genomic', 'cell', 'gene', 'vaccine', 'rx', 'tx',
];

function isFdaRegulatedSignal(domain, jobTitle, companyResearch) {
  if (companyResearch?.is_fda_regulated === true) return true;
  const sigs = (companyResearch?.recent_fda_signals || '').toLowerCase();
  if (sigs.includes('483') || sigs.includes('warning letter') || sigs.includes('inspection')) return true;
  if (domain) {
    const d = domain.toLowerCase();
    for (const kw of FDA_INDUSTRY_KEYWORDS) if (d.includes(kw)) return true;
  }
  if (jobTitle) {
    const t = jobTitle.toLowerCase();
    if (/(gmp|cgmp|gxp|quality assurance|regulatory affairs|csv|computer system valid|qa\/ra)/i.test(t)) return true;
  }
  return false;
}
function isDisqualifiedFit(domain, jobTitle) {
  if (domain) {
    for (const p of NON_FDA_DOMAIN_PATTERNS) {
      if (p.test(domain)) return { disqualified: true, reason: `domain pattern: ${domain}` };
    }
  }
  if (jobTitle) {
    for (const p of NON_BUYER_TITLE_PATTERNS) {
      if (p.test(jobTitle)) return { disqualified: true, reason: `title pattern: ${jobTitle.slice(0, 40)}` };
    }
  }
  return { disqualified: false };
}

async function attioListPeople(maxResults = 1000) {
  const all = [];
  let offset = 0;
  const pageSize = 500;
  while (all.length < maxResults) {
    try {
      const res = await fetch('https://api.attio.com/v2/objects/people/records/query', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ATTIO_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: pageSize, offset, sorts: [{ attribute: 'created_at', direction: 'desc' }] }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) break;
      const json = await res.json();
      const data = json?.data ?? [];
      all.push(...data);
      if (data.length < pageSize) break;
      offset += pageSize;
    } catch { break; }
  }
  return all;
}
function attrVal(record, slug) {
  const v = record?.values?.[slug]?.[0];
  if (!v) return null;
  if (v.status?.title) return v.status.title;
  if (v.option?.title) return v.option.title;
  if (v.full_name) return v.full_name;
  if (v.email_address) return v.email_address;
  if (v.value !== undefined) return v.value;
  if (v.interacted_at) return v.interacted_at;
  return v;
}
function looksLikeGibberish(s) {
  if (!s) return false;
  const str = s.trim();
  if (str.length < 3) return false;
  let caseChanges = 0;
  for (let i = 1; i < str.length; i++) {
    const a = str[i - 1]; const b = str[i];
    if (/[a-z]/.test(a) && /[A-Z]/.test(b)) caseChanges++;
    if (/[A-Z]/.test(a) && /[a-z]/.test(b)) caseChanges++;
  }
  if (str.length >= 8 && caseChanges / str.length > 0.3) return true;
  const letters = str.replace(/[^a-zA-Z]/g, '');
  if (letters.length >= 6) {
    const vowels = (letters.match(/[aeiouAEIOU]/g) || []).length;
    if (vowels / letters.length < 0.20) return true;
  }
  const consonantRun = letters.match(/[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ]{4,}/);
  if (consonantRun && consonantRun[0].length >= 4) return true;
  if (/\d/.test(str)) return true;
  return false;
}
function isBotEmail(email) {
  if (!email) return false;
  const lc = email.toLowerCase();
  const local = lc.split('@')[0] || '';
  const domain = lc.split('@')[1] || '';
  const freemail = ['hotmail.com','outlook.com','live.com','yahoo.com','aol.com','icloud.com','gmail.com'];
  if (freemail.includes(domain)) {
    if (/^[a-z]+\d{3,}$/i.test(local)) return true;
    const dots = (local.match(/\./g) || []).length;
    const digits = (local.match(/\d/g) || []).length;
    if (dots >= 2 && digits >= 2) return true;
  }
  return false;
}
function isTestEmail(email) {
  if (!email) return false;
  const lc = email.toLowerCase();
  if (lc.includes('test@') || lc.includes('+test') || lc.startsWith('test')) return true;
  if (lc.includes('demo@') || lc.startsWith('demo.')) return true;
  if (lc.includes('example.com')) return true;
  if (/^ddr\.test/.test(lc)) return true;
  return false;
}
function isBotContact(name, email) {
  if (isTestEmail(email)) return true;
  if (isBotEmail(email)) return true;
  if (looksLikeGibberish(name)) return true;
  return false;
}

function markdownToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let inTable = false;
  let tableRows = [];
  let inList = false;
  const flushTable = () => {
    if (tableRows.length === 0) return;
    const [header, _sep, ...body] = tableRows;
    out.push('<table style="border-collapse:collapse;margin:8px 0;">');
    out.push('<thead><tr>' + header.map(c => `<th style="border:1px solid #ccc;padding:4px 8px;background:#f5f6f7;text-align:left;">${c}</th>`).join('') + '</tr></thead>');
    out.push('<tbody>' + body.map(r => '<tr>' + r.map(c => `<td style="border:1px solid #ccc;padding:4px 8px;">${c}</td>`).join('') + '</tr>').join('') + '</tbody>');
    out.push('</table>');
    tableRows = [];
  };
  const flushList = () => {
    if (inList) { out.push('</ul>'); inList = false; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('|') && line.endsWith('|')) {
      flushList(); inTable = true;
      const cells = line.slice(1, -1).split('|').map(c => c.trim());
      tableRows.push(cells); continue;
    } else if (inTable) { flushTable(); inTable = false; }
    if (line.startsWith('# ')) { flushList(); out.push(`<h1 style="font-family:Inter,sans-serif;color:#0E6F86;">${line.slice(2)}</h1>`); continue; }
    if (line.startsWith('## ')) { flushList(); out.push(`<h2 style="font-family:Inter,sans-serif;color:#0A5F74;margin-top:24px;">${line.slice(3)}</h2>`); continue; }
    if (line.startsWith('### ')) { flushList(); out.push(`<h3 style="font-family:Inter,sans-serif;color:#0A5F74;">${line.slice(4)}</h3>`); continue; }
    if (line.startsWith('- ')) {
      if (!inList) { out.push('<ul>'); inList = true; }
      const content = line.slice(2)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>');
      out.push(`<li>${content}</li>`); continue;
    }
    if (line.trim() === '') { flushList(); out.push('<br/>'); continue; }
    flushList();
    const html = line
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>');
    out.push(`<p style="margin:6px 0;">${html}</p>`);
  }
  flushList();
  if (inTable) flushTable();
  return `<div style="font-family:Inter,Helvetica,Arial,sans-serif;color:#3A3A3A;font-size:14px;line-height:1.5;">${out.join('\n')}</div>`;
}

async function getGmailAccessToken() {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    return { token: null, error: 'Gmail OAuth env vars missing' };
  }
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GMAIL_CLIENT_ID,
        client_secret: GMAIL_CLIENT_SECRET,
        refresh_token: GMAIL_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { token: null, error: `OAuth refresh: ${res.status} ${errText}` };
    }
    const json = await res.json();
    return { token: json.access_token, error: null };
  } catch (e) {
    return { token: null, error: `OAuth fetch: ${e.message}` };
  }
}

function encodeBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendBriefEmail(subject, markdown) {
  const { token, error: tokenErr } = await getGmailAccessToken();
  if (!token) return { ok: false, error: tokenErr ?? 'no token' };

  const html = markdownToHtml(markdown);
  const boundary = `cwbrief_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const message = [
    `From: "${BRIEF_FROM_NAME}" <${BRIEF_FROM_EMAIL}>`,
    `To: ${BRIEF_RECIPIENT}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    markdown,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    html,
    ``,
    `--${boundary}--`,
  ].join('\r\n');

  const raw = encodeBase64Url(message);
  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Gmail send: ${res.status} ${errText}` };
    }
    const data = await res.json();
    return { ok: true, messageId: data?.id };
  } catch (e) {
    return { ok: false, error: `Gmail fetch: ${e.message}` };
  }
}

Deno.serve(async () => {
  const start = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayISO = yesterday.toISOString().slice(0, 10);
  const last24hStart = new Date(Date.now() - 24 * 3600_000).toISOString();
  const yesterdayStartISO = `${yesterdayISO}T00:00:00.000Z`;
  const yesterdayEndISO = `${yesterdayISO}T23:59:59.999Z`;

  // ============================================================
  // V25 NEW: Revenue progress against May $1,500 target
  // ============================================================
  const { data: mayOrders } = await supabase
    .from('orders').select('amount_cents, created_at')
    .gte('created_at', MAY_START_ISO).lte('created_at', MAY_END_ISO);
  const mayRevenueCents = (mayOrders ?? []).reduce((sum, o) => sum + (o.amount_cents || 0), 0);
  const mayRevenueDollars = Math.round(mayRevenueCents / 100);
  const mayOrderCount = (mayOrders ?? []).length;

  const now = new Date();
  const mayEnd = new Date(MAY_END_ISO);
  const daysRemaining = Math.max(0, Math.ceil((mayEnd.getTime() - now.getTime()) / (24 * 3600_000)));
  const dayOfMay = Math.min(31, Math.max(1, now.getUTCDate()));
  const projectedMonthEnd = dayOfMay > 0 ? Math.round((mayRevenueDollars / dayOfMay) * 31) : 0;
  const gapToTarget = MAY_TARGET_DOLLARS - mayRevenueDollars;
  const pctOfTarget = Math.round((mayRevenueDollars / MAY_TARGET_DOLLARS) * 100);

  // ============================================================
  // Outbound Activity — yesterday only (existing v24)
  // ============================================================
  const { count: dms_sent_yesterday } = await supabase
    .from('warm_outbound_staging').select('*', { count: 'exact', head: true })
    .gte('dm_first_message_sent_at', yesterdayStartISO).lte('dm_first_message_sent_at', yesterdayEndISO);
  const { count: connection_requests_sent_yesterday } = await supabase
    .from('warm_outbound_staging').select('*', { count: 'exact', head: true })
    .gte('dm_connection_request_sent_at', yesterdayStartISO).lte('dm_connection_request_sent_at', yesterdayEndISO);
  const { count: connections_accepted_yesterday } = await supabase
    .from('warm_outbound_staging').select('*', { count: 'exact', head: true })
    .gte('dm_connection_accepted_at', yesterdayStartISO).lte('dm_connection_accepted_at', yesterdayEndISO);
  const { count: emails_sent_yesterday } = await supabase
    .from('gmail_send_log').select('*', { count: 'exact', head: true })
    .eq('send_date', yesterdayISO);
  const { count: dm_replies_yesterday } = await supabase
    .from('warm_outbound_staging').select('*', { count: 'exact', head: true })
    .gte('dm_replied_at', yesterdayStartISO).lte('dm_replied_at', yesterdayEndISO);
  const { count: email_replies_yesterday } = await supabase
    .from('inbound_replies').select('*', { count: 'exact', head: true })
    .gte('received_at', yesterdayStartISO).lte('received_at', yesterdayEndISO);

  const sevenDayStart = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { count: dms_sent_7d } = await supabase
    .from('warm_outbound_staging').select('*', { count: 'exact', head: true })
    .gte('dm_first_message_sent_at', sevenDayStart);
  const { count: emails_sent_7d } = await supabase
    .from('gmail_send_log').select('*', { count: 'exact', head: true })
    .gte('created_at', sevenDayStart);
  const { count: replies_7d } = await supabase
    .from('inbound_replies').select('*', { count: 'exact', head: true })
    .gte('received_at', sevenDayStart);

  const { data: replies24h } = await supabase
    .from('inbound_replies')
    .select('id, received_at, from_email, from_name, subject, body_plain, classification, classification_reason, classification_confidence, reply_sentiment, recommended_stage, asset_requested, draft_subject, draft_body, draft_status, attio_record_id, hot_lead_task_id')
    .gte('received_at', last24hStart)
    .order('received_at', { ascending: false });

  const { data: dmRepliesData } = await supabase
    .from('warm_outbound_staging')
    .select('id, full_name, company, job_title, linkedin_url, dm_replied_at, dm_status, attio_record_id')
    .gte('dm_replied_at', last24hStart)
    .order('dm_replied_at', { ascending: false });

  const { data: pipelineSummary } = await supabase.from('pipeline_summary').select('*');
  const stageMap = {};
  for (const row of pipelineSummary ?? []) stageMap[row.stage] = row.lead_count;

  const { data: followupRows } = await supabase.from('followup_due_today').select('*');
  const followups_due = followupRows ?? [];

  // V25: count followups missing inspector_angle
  const followupsMissingAngle = followups_due.filter((f) => {
    const a = (f.inspector_angle || '').trim();
    return !a || a.toLowerCase().startsWith('no research') || a === 'null';
  }).length;

  const { data: stuckRows } = await supabase
    .from('pipeline_view')
    .select('email, full_name, company, hours_stuck_in_enrichment, entered_pipeline_at')
    .eq('stage', 'awaiting_enrichment')
    .gt('hours_stuck_in_enrichment', 24)
    .order('hours_stuck_in_enrichment', { ascending: false })
    .limit(20);
  const stuck_count = stuckRows?.length ?? 0;

  const { count: prospeo_credit_fails } = await supabase
    .from('warm_outbound_staging')
    .select('*', { count: 'exact', head: true })
    .eq('enrichment_status', 'failed_insufficient_credits')
    .gte('enriched_at', new Date(Date.now() - 24 * 3600_000).toISOString());

  const { data: engagedRows } = await supabase
    .from('pipeline_view')
    .select('email, full_name, company, job_title, replied_at, last_attio_status, attio_record_id')
    .eq('stage', 'engaged')
    .order('replied_at', { ascending: false });
  const engaged_leads = engagedRows ?? [];

  const { count: total_emailed_ever } = await supabase
    .from('warm_outbound_staging').select('*', { count: 'exact', head: true })
    .not('dispatched_at', 'is', null);
  const { count: total_replied_ever } = await supabase
    .from('warm_outbound_staging').select('*', { count: 'exact', head: true })
    .not('replied_at', 'is', null);
  const conversion_rate = {
    emailed_total: total_emailed_ever ?? 0,
    replied_total: total_replied_ever ?? 0,
    percentage: (total_emailed_ever ?? 0) > 0 ? Math.round(((total_replied_ever ?? 0) / (total_emailed_ever ?? 1)) * 100 * 10) / 10 : null,
  };

  const { data: delivRows } = await supabase
    .from('v_deliverability_signals')
    .select('*');
  const deliv = delivRows?.[0] ?? null;

  const { data: noEmailRows } = await supabase
    .from('pipeline_view')
    .select('full_name, company, company_domain, job_title, linkedin_url')
    .eq('stage', 'no_email_found');
  const { data: companiesResearch } = await supabase
    .from('companies_research')
    .select('domain, recent_fda_signals, is_fda_regulated, inspector_angle');
  const researchMap = new Map((companiesResearch ?? []).map((r) => [r.domain?.toLowerCase(), r]));

  const high_value_no_email = (noEmailRows ?? [])
    .map((r) => {
      const research = r.company_domain ? researchMap.get(r.company_domain.toLowerCase()) : null;
      if (!research) return null;
      const sigs = (research.recent_fda_signals || '').toLowerCase();
      const has483 = sigs.includes('483');
      const hasWarning = sigs.includes('warning letter');
      const hasInspection = sigs.includes('inspection');
      if (!has483 && !hasWarning && !hasInspection) return null;
      return {
        name: r.full_name, company: r.company, domain: r.company_domain,
        job_title: r.job_title, linkedin_url: r.linkedin_url,
        signals: [has483 ? '483' : null, hasWarning ? 'Warning Letter' : null, hasInspection ? 'Recent Inspection' : null].filter(Boolean).join(', '),
        inspector_angle: research.inspector_angle,
      };
    })
    .filter((x) => x !== null).slice(0, 10);

  const { data: recentEvents } = await supabase
    .from('events').select('event_name, page, properties, session_id, created_at')
    .gte('created_at', last24hStart);

  const high_value_pages = ['pricing', 'membership', 'authorization-package', 'sign-up', 'signup', 'docs', 'inspection-readiness'];
  const high_value_actions = [];
  const hot_lead_emails = new Set();
  for (const e of recentEvents ?? []) {
    const page = (e.page || '').toLowerCase();
    const props = e.properties || {};
    const email = (props.email || props.contact_email || '').toLowerCase();
    if (isBotEmail(email) || isTestEmail(email)) continue;
    if (high_value_pages.some(hv => page.includes(hv))) {
      high_value_actions.push({ event: e.event_name, page: e.page, contact: email || props.session_id || e.session_id, at: e.created_at });
    }
    if (email) hot_lead_emails.add(email);
  }

  const allPeople = await attioListPeople(1000);
  const totalAttioPeople = allPeople.length;
  const yesterdayStart = new Date(yesterdayISO + 'T00:00:00Z').toISOString();
  const yesterdayEnd = new Date(yesterdayISO + 'T23:59:59Z').toISOString();
  const new_leads_yesterday = allPeople.filter((p) => {
    const c = attrVal(p, 'created_at');
    return c && c >= yesterdayStart && c <= yesterdayEnd;
  }).length;

  const hot_leads_24h = allPeople
    .filter((p) => {
      const e = attrVal(p, 'email_addresses');
      const name = attrVal(p, 'name');
      const emailStr = typeof e === 'string' ? e : null;
      if (isBotContact(name, emailStr)) return false;
      return emailStr && hot_lead_emails.has(emailStr.toLowerCase());
    })
    .map((p) => ({
      record_id: p.id?.record_id, name: attrVal(p, 'name'),
      email: attrVal(p, 'email_addresses'), job_title: attrVal(p, 'job_title'),
      outreach_status: attrVal(p, 'outreach_status') || 'Not Contacted',
    })).slice(0, 20);

  function seniorityScore(jobTitle) {
    if (!jobTitle) return { score: 0, level: 'unknown' };
    const head = jobTitle.toLowerCase().slice(0, 80);
    if (/\b(chief|cqo|cco|founder|owner|president)\b/.test(head)) return { score: 30, level: 'C-Level' };
    if (/\b(svp|senior vice president)\b/.test(head)) return { score: 30, level: 'SVP' };
    if (/\bvp\b|\bvice president\b/.test(head)) return { score: 28, level: 'VP' };
    if (/\bhead of\b/.test(head)) return { score: 25, level: 'Head' };
    if (/\bdirector\b/.test(head)) return { score: 20, level: 'Director' };
    if (/\bsenior manager|sr\.? manager\b/.test(head)) return { score: 15, level: 'Sr Manager' };
    if (/\bmanager\b/.test(head)) return { score: 10, level: 'Manager' };
    if (/\b(senior|sr\.?)\b/.test(head)) return { score: 5, level: 'Senior IC' };
    return { score: 0, level: 'IC' };
  }
  function fitScore(domain) {
    if (!domain) return { score: 0, reasons: ['no domain'] };
    const r = researchMap.get(domain.toLowerCase());
    if (!r) return { score: 0, reasons: [] };
    let s = 0; const reasons = [];
    const sigs = (r.recent_fda_signals || '').toLowerCase();
    if (sigs.includes('483')) { s += 20; reasons.push('Recent 483'); }
    if (sigs.includes('warning letter')) { s += 20; reasons.push('Warning letter'); }
    if (sigs.includes('inspection')) { s += 10; reasons.push('Recent inspection'); }
    if (r.is_fda_regulated) { s += 10; reasons.push('FDA-regulated'); }
    return { score: Math.min(s, 40), reasons };
  }
  function intentScore(email) {
    if (!email) return { score: 0, reasons: [] };
    const lc = email.toLowerCase();
    let s = 0; const reasons = [];
    if (hot_lead_emails.has(lc)) { s += 30; reasons.push('Visited site in last 24h'); }
    return { score: Math.min(s, 30), reasons };
  }

  const candidates = allPeople
    .filter((p) => {
      const status = attrVal(p, 'outreach_status');
      return status === 'Not Contacted' || status === null;
    })
    .map((p) => {
      const name = attrVal(p, 'name');
      const emailRaw = attrVal(p, 'email_addresses');
      const email = typeof emailRaw === 'string' ? emailRaw : null;
      const jobTitle = attrVal(p, 'job_title');
      const domain = email ? email.split('@')[1] : null;
      if (!email || !name || !jobTitle) return null;
      if (isBotContact(name, email)) return null;
      const dq = isDisqualifiedFit(domain, jobTitle);
      if (dq.disqualified) return null;
      const research = domain ? researchMap.get(domain.toLowerCase()) : null;
      if (!isFdaRegulatedSignal(domain, jobTitle, research)) return null;
      const sen = seniorityScore(jobTitle);
      const fit = fitScore(domain);
      const intent = intentScore(email);
      return {
        record_id: p.id?.record_id,
        attio_url: `https://app.attio.com/compliance-worxs/person/${p.id?.record_id}`,
        name, email, job_title: jobTitle?.slice(0, 80), company_domain: domain,
        score: sen.score + fit.score + intent.score,
        seniority: sen, fit, intent,
      };
    })
    .filter((x) => x !== null)
    .sort((a, b) => b.score - a.score);
  const golden_5 = candidates.slice(0, 5);

  const { data: yieldRows } = await supabase
    .from('v_source_yield_decisions').select('*');
  const yield_rows = yieldRows ?? [];
  const scale_sources = yield_rows.filter((r) => r.recommended_action === 'SCALE');
  const kill_sources = yield_rows.filter((r) => r.recommended_action?.startsWith('KILL'));
  const measure_promising = yield_rows.filter((r) => r.recommended_action === 'MEASURE_promising');

  const verdictMessage = {
    INSUFFICIENT_DATA: 'Hold daily cap at 25. Less than 50 sends in the 7-day window. Need more volume before signal is meaningful.',
    GOVERNOR_NOT_READY: 'Hold daily cap at 25. Shadow Governor needs 7 days of decision history before scaling.',
    BLOCKED_BOUNCE_TOO_HIGH: 'DO NOT SCALE. Bounce rate >= 8%. Investigate enrichment quality before any volume increase.',
    WAIT_NO_SCALE_SIGNAL: 'Hold daily cap at 25. Bounces clean and Governor active, but no source has produced a SCALE recommendation yet.',
    CLEAR_TO_SCALE: 'Cleared to bump daily cap. Bounces clean, 7+ days of governor data, and at least one source is producing replies. Recommend stepping cap from 25 to 35.',
  };

  // ============================================================
  // V25: TOP-OF-BRIEF ALERTS
  // ============================================================
  const topAlerts = [];

  // Revenue alert — always show, color logic in text
  let revenueLine;
  if (mayRevenueDollars >= MAY_TARGET_DOLLARS) {
    revenueLine = `✅ **REVENUE: $${mayRevenueDollars} of $${MAY_TARGET_DOLLARS} May target HIT** (${mayOrderCount} orders). ${daysRemaining} days remaining.`;
  } else if (projectedMonthEnd >= MAY_TARGET_DOLLARS) {
    revenueLine = `🟢 **REVENUE: $${mayRevenueDollars} of $${MAY_TARGET_DOLLARS} (${pctOfTarget}%)** · ${mayOrderCount} orders · ${daysRemaining}d left · run-rate projects $${projectedMonthEnd}`;
  } else if (mayRevenueDollars > 0) {
    revenueLine = `🟡 **REVENUE: $${mayRevenueDollars} of $${MAY_TARGET_DOLLARS} (${pctOfTarget}%)** · ${mayOrderCount} orders · ${daysRemaining}d left · run-rate projects $${projectedMonthEnd} · gap $${gapToTarget}`;
  } else {
    revenueLine = `🔴 **REVENUE: $0 of $${MAY_TARGET_DOLLARS}** · ${daysRemaining}d left to hit target · zero orders this month`;
  }
  topAlerts.push(revenueLine);

  // DM channel dead alert
  if ((dms_sent_7d ?? 0) === 0) {
    topAlerts.push(`🔴 **DM CHANNEL DEAD:** 0 LinkedIn DMs sent in last 7 days. Phantombuster DM phantom is broken or queue is empty. Outbound is currently email-only.`);
  } else if ((dms_sent_yesterday ?? 0) === 0 && (dms_sent_7d ?? 0) < 10) {
    topAlerts.push(`🟡 **DM CHANNEL LOW:** 0 DMs yesterday, only ${dms_sent_7d} in last 7 days. Check Phantombuster DM phantom.`);
  }

  // Inspector angle coverage gap
  if (followups_due.length > 0 && followupsMissingAngle > 0) {
    const pctMissing = Math.round((followupsMissingAngle / followups_due.length) * 100);
    if (pctMissing >= 50) {
      topAlerts.push(`🔴 **INSPECTOR-ANGLE COVERAGE GAP:** ${followupsMissingAngle} of ${followups_due.length} follow-ups due today (${pctMissing}%) have NO research. Email #2 will go out generic. Check company-research-anthropic cron + Anthropic API credit balance.`);
    } else if (pctMissing >= 25) {
      topAlerts.push(`🟡 **Inspector-angle coverage:** ${followupsMissingAngle} of ${followups_due.length} follow-ups due today (${pctMissing}%) missing research.`);
    }
  }

  const recommendations = [];
  const totalRepliesYest = (dm_replies_yesterday ?? 0) + (email_replies_yesterday ?? 0);
  if (totalRepliesYest === 0 && ((dms_sent_yesterday ?? 0) + (emails_sent_yesterday ?? 0)) > 0) {
    recommendations.unshift(`Zero replies yesterday on ${(dms_sent_yesterday ?? 0) + (emails_sent_yesterday ?? 0)} sends. Check copy and targeting.`);
  }
  if (scale_sources.length > 0) {
    recommendations.unshift(`SCALE: ${scale_sources.length} source(s) producing replies. ${scale_sources[0].source} - ${scale_sources[0].reason}`);
  }
  if (kill_sources.length > 0) {
    recommendations.unshift(`KILL: ${kill_sources.length} source(s) underperforming. ${kill_sources[0].source} - ${kill_sources[0].reason}`);
  }
  if (engaged_leads.length > 0) {
    recommendations.unshift(`${engaged_leads.length} engaged lead(s) need manual reply today. Automation paused.`);
  }
  if ((replies24h?.length ?? 0) > 0) {
    recommendations.unshift(`${replies24h.length} email reply(ies) in last 24h need follow-up — see "Who Responded" section.`);
  }
  if (followups_due.length > 0) {
    recommendations.unshift(`${followups_due.length} follow-up email(s) due today.`);
  }
  if (deliv?.scale_verdict) {
    recommendations.unshift(`DAILY CAP DECISION: ${deliv.scale_verdict} - ${verdictMessage[deliv.scale_verdict] || ''}`);
  }
  if ((prospeo_credit_fails ?? 0) > 0 || stuck_count > 50) {
    recommendations.push(`Prospeo daily credits exhausted (${prospeo_credit_fails ?? 'multiple'} failures in last 24h). ${stuck_count} leads stuck in enrichment.`);
  } else if (stuck_count > 0) {
    recommendations.push(`${stuck_count} leads stuck >24h in awaiting_enrichment.`);
  }
  if ((stageMap['ready_to_email'] || 0) > 20 && (stageMap['emailed'] || 0) < 5) {
    recommendations.push(`${stageMap['ready_to_email']} leads ready_to_email but only ${stageMap['emailed'] || 0} sent. ENRICHMENT IS NOT THE BOTTLENECK - SENDING IS.`);
  }
  if (high_value_no_email.length > 0) {
    recommendations.push(`${high_value_no_email.length} no_email_found leads have 483/warning letter signals - worth manual LinkedIn outreach.`);
  }
  if (hot_leads_24h.length > 0) {
    recommendations.push(`${hot_leads_24h.length} known leads visited site in last 24h - prioritize manual bump email.`);
  }
  if (recommendations.length === 0) {
    recommendations.push('Pipeline within range. Continue current cadence.');
  }

  const stageRow = (label, key) => `| ${label} | ${stageMap[key] || 0} |`;

  const dmsY = dms_sent_yesterday ?? 0;
  const reqsY = connection_requests_sent_yesterday ?? 0;
  const acceptsY = connections_accepted_yesterday ?? 0;
  const emailsY = emails_sent_yesterday ?? 0;
  const dmRepliesY = dm_replies_yesterday ?? 0;
  const emailRepliesY = email_replies_yesterday ?? 0;
  const totalRepliesY = dmRepliesY + emailRepliesY;
  const totalSendsY = dmsY + emailsY;
  const replyRateY = totalSendsY > 0 ? Math.round((totalRepliesY / totalSendsY) * 1000) / 10 : null;

  // V25: Top alerts section sits BEFORE topline
  const topAlertsSection = topAlerts.length > 0 ? `## ALERTS\n\n${topAlerts.map(a => `- ${a}`).join('\n')}\n` : '';

  const outboundActivitySection = `## Yesterday's Outbound Activity\n\n| Channel | Count |\n|---|---|\n| LinkedIn DMs sent | ${dmsY} |\n| Connection requests sent | ${reqsY} |\n| Connections accepted | ${acceptsY} |\n| Emails sent | ${emailsY} |\n| **Total sends** | **${totalSendsY}** |\n| DM replies received | ${dmRepliesY} |\n| Email replies received | ${emailRepliesY} |\n| **Total replies** | **${totalRepliesY}** |\n| Reply rate | ${replyRateY !== null ? replyRateY + '%' : 'n/a'} |\n\n**7-day trailing:** ${dms_sent_7d ?? 0} DMs, ${emails_sent_7d ?? 0} emails, ${replies_7d ?? 0} replies.\n`;

  const replyClassMap = {
    positive: 'Positive — engage now',
    interested: 'Interested — engage now',
    objection: 'Objection — address and re-engage',
    not_now: 'Not now — nurture and follow up later',
    not_interested: 'Not interested — close out, do not pursue',
    unsubscribe: 'Unsubscribe — suppress',
    asset_request: 'Asset requested — send and follow up',
    auto_reply: 'Auto-reply (OOO) — wait and re-touch',
    bounce: 'Bounce — verify email',
    spam: 'Spam — suppress',
    referral: 'Referral — pursue named contact',
    unclear: 'Unclear — review manually',
  };

  let respondedSection = '';
  const hasReplies = (replies24h?.length ?? 0) > 0 || (dmRepliesData?.length ?? 0) > 0;
  if (hasReplies) {
    respondedSection = `## Who Responded — Follow-up Actions (last 24h)\n\n`;

    if ((replies24h?.length ?? 0) > 0) {
      respondedSection += `### Email replies (${replies24h.length})\n\n`;
      for (const r of replies24h) {
        const cls = (r.classification || 'unclassified').toLowerCase();
        const action = replyClassMap[cls] || cls;
        const conf = r.classification_confidence ? ` (${Math.round(r.classification_confidence * 100)}%)` : '';
        const senderLine = r.from_name ? `**${r.from_name}**` : '**' + (r.from_email || 'Unknown') + '**';
        const attioLink = r.attio_record_id ? ` · [Open in Attio](https://app.attio.com/compliance-worxs/person/${r.attio_record_id})` : '';
        respondedSection += `- ${senderLine} (${r.from_email || 'no email'}) — _${r.subject || 'no subject'}_${attioLink}\n`;
        respondedSection += `  - **Classification:** ${cls}${conf}${r.reply_sentiment ? ` · sentiment: ${r.reply_sentiment}` : ''}\n`;
        respondedSection += `  - **Action:** ${action}\n`;
        if (r.recommended_stage) respondedSection += `  - **Recommended pipeline stage:** ${r.recommended_stage}\n`;
        if (r.asset_requested) respondedSection += `  - **Asset requested:** yes — send before responding\n`;
        if (r.draft_body && r.draft_status !== 'sent') {
          const draftPreview = r.draft_body.replace(/\n+/g, ' ').slice(0, 220);
          respondedSection += `  - **Drafted reply (status: ${r.draft_status || 'pending'}):** ${draftPreview}${r.draft_body.length > 220 ? '...' : ''}\n`;
        }
        if (r.classification_reason) respondedSection += `  - _Why classified this way: ${r.classification_reason.slice(0, 180)}_\n`;
        respondedSection += `\n`;
      }
    }

    if ((dmRepliesData?.length ?? 0) > 0) {
      respondedSection += `### LinkedIn DM replies (${dmRepliesData.length})\n\n`;
      for (const d of dmRepliesData) {
        const attioLink = d.attio_record_id ? ` · [Open in Attio](https://app.attio.com/compliance-worxs/person/${d.attio_record_id})` : '';
        respondedSection += `- **${d.full_name || 'Unknown'}** (${d.company || 'no company'}) — ${d.job_title || 'no title'}${attioLink}\n`;
        respondedSection += `  - **DM status:** ${d.dm_status || 'replied'}\n`;
        respondedSection += `  - **Action:** Open LinkedIn thread, qualify, advance to discovery DM (5-step playbook)\n`;
        if (d.linkedin_url) respondedSection += `  - **LinkedIn:** ${d.linkedin_url}\n`;
        respondedSection += `\n`;
      }
    }
  } else {
    respondedSection = `## Who Responded — Follow-up Actions (last 24h)\n\n_No replies in the last 24 hours._\n`;
  }

  const followupSection = followups_due.length > 0 ? `## FOLLOW-UPS DUE TODAY (${followups_due.length})\n` + followups_due.map((f) => `### ${f.full_name} - ${f.company}\n- Email: ${f.email}\n- Title: ${f.job_title || 'n/a'}\n- Sequence stage: ${f.followup_stage} (email #${f.sequence_email_count + 1} due)\n- Days since first email: ${f.days_since_last_email}\n- Inspector angle: ${f.inspector_angle?.slice(0, 250) || 'No research yet'}\n- Open in Attio: https://app.attio.com/compliance-worxs/person/${f.attio_record_id}`).join('\n\n') + '\n' : '';

  const yieldSection = yield_rows.length > 0 ? `## YIELD REPORT - Source Performance\n\n` +
    (scale_sources.length > 0 ? `### SCALE (clone these searches)\n` + scale_sources.map((r) => `- ${r.source} - ${r.reason} | Sent: ${r.leads_sent} | Replies: ${r.leads_replied} (${r.pct_reply_rate ?? 0}%) | Revenue: $${r.revenue_dollars ?? 0}`).join('\n') + '\n\n' : '') +
    (kill_sources.length > 0 ? `### KILL (shut these searches off)\n` + kill_sources.map((r) => `- ${r.source} [${r.recommended_action}] - ${r.reason}`).join('\n') + '\n\n' : '') +
    (measure_promising.length > 0 ? `### PROMISING (waiting on send data)\n` + measure_promising.map((r) => `- ${r.source} - ICP ${r.pct_icp_pass}%, ${r.leads_ingested} ingested, ${r.leads_sent} sent`).join('\n') + '\n\n' : '') +
    `### Full Source Table\n| Source | Ingested | ICP% | Sent | Replies | Reply% | Revenue | Action |\n|---|---|---|---|---|---|---|---|\n` +
    yield_rows.map((r) => `| ${r.source} | ${r.leads_ingested} | ${r.pct_icp_pass ?? '-'}% | ${r.leads_sent} | ${r.leads_replied} | ${r.pct_reply_rate ?? '-'}% | $${r.revenue_dollars ?? 0} | ${r.recommended_action} |`).join('\n') + '\n' : '';

  const deliverabilitySection = deliv ? `## DELIVERABILITY + GOVERNOR VERDICT\n\n**DAILY CAP DECISION: ${deliv.scale_verdict}**\n${verdictMessage[deliv.scale_verdict] || ''}\n\n| Signal | Value |\n|---|---|\n| 7-day sends | ${deliv.sends_7d} |\n| 7-day delivered | ${deliv.delivered_7d} |\n| 7-day bounces | ${deliv.bounced_7d} |\n| 7-day bounce rate | ${deliv.bounce_rate_7d_pct ?? 'n/a'}% |\n| Today's sends | ${deliv.sends_today} |\n| Today's bounces | ${deliv.bounced_today} |\n| Yesterday's sends | ${deliv.sends_yest} |\n| Governor decisions logged | ${deliv.governor_decisions_total} |\n| Governor days active | ${deliv.governor_days_active} / 7 needed |\n| Governor SCALE recs | ${deliv.governor_scale_recs} |\n| Governor KILL recs | ${deliv.governor_kill_recs} |\n` + (deliv.top_bouncing_domains && Array.isArray(deliv.top_bouncing_domains) && deliv.top_bouncing_domains.length > 0 ? `\n**Top bouncing domains:** ` + deliv.top_bouncing_domains.map((d) => `${d.domain} (${d.bounces})`).join(', ') + '\n' : '\n') : '';

  const engagedSection = engaged_leads.length > 0 ? `## ENGAGED - Reply Today\n` + engaged_leads.map((e) => `- ${e.full_name} (${e.company}) - ${e.email} - status: ${e.last_attio_status} - replied: ${e.replied_at?.slice(0,10)}\n  Open: https://app.attio.com/compliance-worxs/person/${e.attio_record_id}`).join('\n') + '\n' : '';

  const stuckSection = stuck_count > 0 ? `## Stuck >24h in enrichment (${stuck_count})\n` + (stuckRows ?? []).slice(0, 5).map((r) => `- ${r.full_name || r.email} (${r.company}) - ${Math.round(r.hours_stuck_in_enrichment)}h stuck`).join('\n') + '\n' : '';

  const heatSection = `## PostHog Heat (24h)\n- Hot leads (visited site): ${hot_leads_24h.length}\n- High-value page hits: ${high_value_actions.length}` + (hot_leads_24h.length > 0 ? '\nVisiting now:\n' + hot_leads_24h.map((h) => `- ${h.name} - ${h.email} - ${h.job_title}`).join('\n') : '');

  const noEmailSection = high_value_no_email.length > 0 ? `## High-Value no_email_found (worth manual research)\n` + high_value_no_email.map((h) => `- ${h.name} (${h.company}) - ${h.signals}\n  ${h.linkedin_url || ''}\n  Inspector angle: ${h.inspector_angle?.slice(0, 200) || 'n/a'}`).join('\n') + '\n' : '';

  const goldenSection = golden_5.length > 0 ? golden_5.map((g, i) => `**${i + 1}. ${g.name}** (score ${g.score})\n- ${g.job_title}\n- ${g.company_domain}\n- Why: ${[g.seniority.level, ...g.fit.reasons, ...g.intent.reasons].join(' - ')}\n- Open: ${g.attio_url}`).join('\n\n') : '_No FDA-regulated qualified prospects in Not Contacted status. Check Attio fit research._';

  // V25: Alerts go FIRST, then topline, then everything else as before
  const markdown_summary = `# CW Daily Brief - ${yesterdayISO}\n\n${topAlertsSection}\n## Topline\n- Total Attio people: ${totalAttioPeople}\n- New yesterday: ${new_leads_yesterday}\n- Conversion rate (emailed -> replied): ${conversion_rate.percentage !== null ? conversion_rate.percentage + '%' : 'n/a'} (${conversion_rate.replied_total}/${conversion_rate.emailed_total})\n- Follow-ups due today: ${followups_due.length}\n- May revenue MTD: $${mayRevenueDollars} of $${MAY_TARGET_DOLLARS} (${pctOfTarget}%) · ${mayOrderCount} orders · ${daysRemaining}d left\n\n${outboundActivitySection}\n\n${respondedSection}\n\n${deliverabilitySection}\n\n${yieldSection}\n\n${engagedSection}\n\n${followupSection}\n\n## Pipeline Stages (canonical)\n| Stage | Count |\n|---|---|\n${stageRow('Engaged (replied, paused)', 'engaged')}\n${stageRow('Qualified', 'qualified')}\n${stageRow('Emailed (in sequence)', 'emailed')}\n${stageRow('Ready to email', 'ready_to_email')}\n${stageRow('No email found', 'no_email_found')}\n${stageRow('Awaiting enrichment', 'awaiting_enrichment')}\n${stageRow('Nurture long-term', 'nurture_long_term')}\n${stageRow('Disqualified', 'disqualified')}\n${stageRow('Archived', 'archived')}\n\n${stuckSection}\n\n${heatSection}\n\n${noEmailSection}\n\n## The Golden 5 (FDA-regulated only)\n${goldenSection}\n\n## Today's Recommendations\n${recommendations.map(r => `- ${r}`).join('\n')}\n`;

  const verdictTag = deliv?.scale_verdict ? ` [${deliv.scale_verdict}]` : '';
  const emailSubject = `CW Daily Brief - ${yesterdayISO} - $${mayRevenueDollars}/$${MAY_TARGET_DOLLARS} · ${totalSendsY} sent, ${totalRepliesY} replies, ${followups_due.length} follow-ups${verdictTag}`;
  const emailResult = await sendBriefEmail(emailSubject, markdown_summary);

  const payload = {
    report_date: yesterdayISO,
    total_leads: totalAttioPeople, new_leads_yesterday,
    pipeline_stages: stageMap, engaged_leads, followups_due,
    stuck_count, stuck_leads: stuckRows ?? [],
    prospeo_credit_fails_24h: prospeo_credit_fails ?? 0,
    conversion_rate, high_value_no_email, hot_leads_24h,
    high_value_actions: high_value_actions.slice(0, 20),
    golden_5, recommendations, top_alerts: topAlerts,
    yield_summary: { total_sources: yield_rows.length, scale: scale_sources.length, kill: kill_sources.length, promising: measure_promising.length },
    deliverability: deliv,
    revenue_progress: {
      target: MAY_TARGET_DOLLARS, mtd_dollars: mayRevenueDollars, order_count: mayOrderCount,
      pct_of_target: pctOfTarget, gap_to_target: gapToTarget,
      projected_month_end: projectedMonthEnd, days_remaining: daysRemaining,
    },
    inspector_angle_coverage: {
      followups_total: followups_due.length, followups_missing_angle: followupsMissingAngle,
      pct_missing: followups_due.length > 0 ? Math.round((followupsMissingAngle / followups_due.length) * 100) : 0,
    },
    outbound_activity_yesterday: {
      dms_sent: dmsY, connection_requests_sent: reqsY, connections_accepted: acceptsY,
      emails_sent: emailsY, dm_replies: dmRepliesY, email_replies: emailRepliesY,
      total_sends: totalSendsY, total_replies: totalRepliesY, reply_rate_pct: replyRateY,
    },
    outbound_activity_7d: { dms_sent: dms_sent_7d ?? 0, emails_sent: emails_sent_7d ?? 0, replies: replies_7d ?? 0 },
    replies_24h_count: (replies24h?.length ?? 0) + (dmRepliesData?.length ?? 0),
    replies_24h_email: replies24h ?? [],
    replies_24h_dm: dmRepliesData ?? [],
    duration_ms: Date.now() - start,
    email_sent: emailResult.ok,
    email_message_id: emailResult.messageId ?? null,
    email_error: emailResult.error ?? null,
  };

  const { error } = await supabase.from('daily_brief_log').insert({
    report_date: yesterdayISO, total_leads: totalAttioPeople,
    new_leads_yesterday, status_breakdown: stageMap, hot_leads_24h,
    high_value_actions: high_value_actions.slice(0, 20), golden_5,
    revenue_optimization: { recommendations, followups_due_count: followups_due.length, email_sent: emailResult.ok, prospeo_credit_fails_24h: prospeo_credit_fails ?? 0 },
    raw_payload: { generated_at: new Date().toISOString(), version: 'v25-revenue-dm-angle-alerts', markdown_summary, ...payload },
  });

  return new Response(JSON.stringify({ ...payload, markdown_summary, log_write_error: error?.message ?? null }, null, 2),
    { headers: { 'Content-Type': 'application/json' } });
});