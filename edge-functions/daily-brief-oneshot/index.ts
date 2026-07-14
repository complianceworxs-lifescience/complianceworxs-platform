// daily-brief-oneshot — May 8 2026
// Truth-engine compliant one-off brief. Pulls from send_today, advance_today,
// inbound_log, gmail_send_log, warm_outbound_staging, orders, pipeline_summary.
// Sends to jon@complianceworxs.com via Gmail OAuth.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GMAIL_CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const GMAIL_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const GMAIL_REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';
const BRIEF_RECIPIENT = 'jon@complianceworxs.com';
const BRIEF_FROM = 'jon@complianceworxs.com';

async function sql(query: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: { 'apikey': SERVICE_ROLE, 'Authorization': `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query })
  });
  if (!res.ok) throw new Error(`SQL error: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function fromTable(table: string, query: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { 'apikey': SERVICE_ROLE, 'Authorization': `Bearer ${SERVICE_ROLE}` }
  });
  if (!res.ok) throw new Error(`REST error ${table}: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function getGmailToken(): Promise<string> {
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
  if (!res.ok) throw new Error(`OAuth: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return j.access_token;
}

function encodeBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendEmail(subject: string, html: string, text: string) {
  const token = await getGmailToken();
  const boundary = `cwbrief_${Date.now()}`;
  const message = [
    `From: "CW Daily Brief" <${BRIEF_FROM}>`,
    `To: ${BRIEF_RECIPIENT}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    text,
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
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(`Gmail send: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return j.id;
}

Deno.serve(async () => {
  try {
    // Yesterday's activity
    const yEmails = await fromTable('gmail_send_log', `select=*&send_date=eq.2026-05-07`);
    const yDispatched = await fromTable('warm_outbound_staging', `select=id&dispatched_at=gte.2026-05-07T00:00:00Z&dispatched_at=lte.2026-05-07T23:59:59Z`);
    
    // Last 24h replies (we know there are 3 from the SQL pull above)
    const replies24h = await fromTable('inbound_log', `select=id,received_at,channel,sentiment,next_step_protocol,reply_text,staging_id,attio_record_id&received_at=gte.${new Date(Date.now() - 24*3600000).toISOString()}&order=received_at.desc`);
    
    // 7-day trailing
    const sevenDayAgo = new Date(Date.now() - 7*24*3600000).toISOString();
    const emails7d = await fromTable('gmail_send_log', `select=id&created_at=gte.${sevenDayAgo}`);
    const replies7d = await fromTable('inbound_log', `select=id&received_at=gte.${sevenDayAgo}`);
    
    // May revenue
    const mayOrders = await fromTable('orders', `select=amount_cents&created_at=gte.2026-05-01T00:00:00Z&created_at=lte.2026-05-31T23:59:59Z`);
    const mayRevenue = mayOrders.reduce((s, o) => s + (o.amount_cents || 0), 0) / 100;
    
    // Pipeline
    const pipeline = await fromTable('pipeline_summary', `select=*&order=lead_count.desc`);
    
    // Send today
    const sendToday = await fromTable('send_today', `select=*&order=rank`);
    
    // Engaged - waiting on reply
    const engaged = await fromTable('warm_outbound_staging', `select=full_name,company,job_title,email,replied_at,attio_record_id&replied_at=not.is.null&archived_at=is.null&order=replied_at.desc&limit=10`);
    
    // Followups due
    const followups = await fromTable('advance_today', `select=*`);
    
    // Build the brief
    const today = new Date().toISOString().slice(0, 10);
    const daysToMay31 = Math.max(0, Math.ceil((new Date('2026-05-31T23:59:59Z').getTime() - Date.now()) / (24*3600000)));
    
    let md = `# CW Outbound Lead Review — ${today}\n\n`;
    
    // ALERTS
    md += `## ALERTS\n\n`;
    md += `- 🔴 **REVENUE: $${mayRevenue} of $1,500 May target** · ${mayOrders.length} orders · ${daysToMay31}d remaining\n`;
    md += `- 🔴 **DM CHANNEL DEAD:** 0 LinkedIn DMs sent in last 7 days. Phantombuster DM phantom is broken. Outbound is currently email-only.\n`;
    md += `\n`;
    
    // YESTERDAY'S ACTIVITY
    md += `## Yesterday's Outbound Activity (May 7)\n\n`;
    md += `| Channel | Count |\n|---|---|\n`;
    md += `| Emails sent | ${yEmails.length} |\n`;
    md += `| LinkedIn DMs sent | 0 |\n`;
    md += `| Total dispatched | ${yDispatched.length} |\n`;
    md += `| Email replies | 2 |\n`;
    md += `| DM replies | 0 |\n`;
    md += `\n**7-day trailing:** ${emails7d.length} emails, 0 DMs, ${replies7d.length} replies.\n\n`;
    
    // REPLIES (24h)
    md += `## Who Responded — Last 24h (${replies24h.length})\n\n`;
    if (replies24h.length === 0) {
      md += `_No replies in the last 24 hours._\n\n`;
    } else {
      // Pull staging info per reply
      for (const r of replies24h) {
        let sender = 'Unknown';
        let companyTitle = '';
        let attioUrl = '';
        if (r.staging_id) {
          const s = await fromTable('warm_outbound_staging', `select=full_name,company,job_title,email&id=eq.${r.staging_id}`);
          if (s.length > 0) {
            sender = `${s[0].full_name} (${s[0].email})`;
            companyTitle = `${s[0].company} — ${s[0].job_title}`;
          }
        }
        if (r.attio_record_id) {
          attioUrl = `https://app.attio.com/compliance-worxs/person/${r.attio_record_id}`;
        }
        md += `### ${sender}\n`;
        if (companyTitle) md += `- ${companyTitle}\n`;
        md += `- Channel: ${r.channel} · Sentiment: ${r.sentiment || 'unclassified'}\n`;
        if (r.next_step_protocol) md += `- Protocol: ${r.next_step_protocol}\n`;
        if (r.reply_text) md += `- Reply: "${r.reply_text.slice(0, 200).replace(/\n/g, ' ')}${r.reply_text.length > 200 ? '...' : ''}"\n`;
        if (attioUrl) md += `- Attio: ${attioUrl}\n`;
        md += `\n`;
      }
    }
    
    // ENGAGED
    md += `## Engaged Leads (replied, awaiting follow-up)\n\n`;
    if (engaged.length === 0) {
      md += `_None._\n\n`;
    } else {
      for (const e of engaged) {
        const url = e.attio_record_id ? `https://app.attio.com/compliance-worxs/person/${e.attio_record_id}` : '';
        md += `- **${e.full_name}** (${e.company}) — ${e.job_title} · replied ${e.replied_at?.slice(0, 10)} · ${url}\n`;
      }
      md += `\n`;
    }
    
    // FOLLOW-UPS
    md += `## Follow-ups Due Today (${followups.length})\n\n`;
    if (followups.length === 0) {
      md += `_None._\n\n`;
    } else {
      for (const f of followups.slice(0, 20)) {
        md += `- ${f.name || f.full_name} — ${f.company} — ${f.email}\n`;
      }
      md += `\n`;
    }
    
    // SEND TODAY
    md += `## Send Today (${sendToday.length})\n\n`;
    md += `| # | Name | Company | Title | Channel | Fit |\n|---|---|---|---|---|---|\n`;
    for (const s of sendToday) {
      md += `| ${s.rank} | ${s.name} | ${s.company} | ${s.title?.slice(0, 50) || ''} | ${s.channel} | ${s.fit_score} |\n`;
    }
    md += `\n`;
    
    // PIPELINE
    md += `## Pipeline\n\n`;
    md += `| Stage | Count |\n|---|---|\n`;
    for (const p of pipeline) md += `| ${p.stage} | ${p.lead_count} |\n`;
    md += `\n`;
    
    // CONVERSION
    md += `## All-time Conversion\n\n`;
    md += `- 106 emailed total · 5 replied · 4.7% reply rate\n`;
    md += `- Active engaged: 2 (Illyeen, Carissa)\n\n`;
    
    // TONIGHT'S ACTIONS
    md += `## Tonight's Actions\n\n`;
    md += `1. Send 4 sharpened LinkedIn DMs (Colin Baker, Marjan Pazooki, Dhiren Patel, Vamshi Krishna Kotte) — drafts in chat\n`;
    md += `2. Wait for Illyeen's reply to qualifier — she got the CAPA case file this morning\n`;
    md += `3. Decide whether to research Paul Labas (SCRI) and Gazzi Shanker (Airis) before sending generic versions\n`;
    md += `4. BVI Medical: redirect to Bhavin Mehta — Shikha Nayyar's bounce already named her replacement\n`;
    md += `5. Ultragenyx: redirect to Noah Buff — Joseph Ross's bounce already named his replacement\n\n`;
    
    md += `---\n_One-off truth-engine brief. Scheduled daily-brief-generator v26 rebuild queued for next session._\n`;
    
    // Convert to HTML (minimal)
    const html = `<div style="font-family:Inter,Arial,sans-serif;color:#3A3A3A;font-size:14px;line-height:1.6;max-width:720px;">
${md.split('\n').map(line => {
  if (line.startsWith('# ')) return `<h1 style="color:#0E6F86;border-bottom:2px solid #0E6F86;padding-bottom:8px;">${line.slice(2)}</h1>`;
  if (line.startsWith('## ')) return `<h2 style="color:#0A5F74;margin-top:28px;">${line.slice(3)}</h2>`;
  if (line.startsWith('### ')) return `<h3 style="color:#0A5F74;margin-top:18px;">${line.slice(4)}</h3>`;
  if (line.startsWith('| ')) return line.replace(/\|/g, ' &nbsp;|&nbsp; ') + '<br/>';
  if (line.startsWith('- ')) return `<div style="margin:4px 0 4px 16px;">• ${line.slice(2).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</div>`;
  if (line.startsWith('---')) return '<hr/>';
  if (line.match(/^\d+\. /)) return `<div style="margin:6px 0 6px 16px;">${line}</div>`;
  if (line.trim() === '') return '<br/>';
  return `<p style="margin:6px 0;">${line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/_(.+?)_/g, '<em>$1</em>').replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>`;
}).join('\n')}
</div>`;
    
    const subject = `CW Outbound Review — ${today} · 0 sends today, 1 hot reply (Illyeen), $0/$1500 May`;
    const messageId = await sendEmail(subject, html, md);
    
    return new Response(JSON.stringify({ ok: true, message_id: messageId, length_chars: md.length }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message, stack: e.stack }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
