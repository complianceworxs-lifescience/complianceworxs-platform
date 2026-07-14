// partner-application-notifier v25
// CHANGES from v24:
//   - Replaced Resend (deprecated) with Gmail OAuth for both notifications.
//   - Created partner_applications table out-of-band; this function now writes to it cleanly.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ATTIO_API_KEY = Deno.env.get('ATTIO_API_KEY') ?? '';
const GMAIL_CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const GMAIL_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const GMAIL_REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';

const NOTIFY_TO = 'jon@complianceworxs.com';
const NOTIFY_FROM_NAME = 'ComplianceWorxs Partner';
const NOTIFY_FROM_EMAIL = 'jon@complianceworxs.com';
const APPLICANT_FROM_NAME = 'Jon Nugent';
const APPLICANT_FROM_EMAIL = 'jon@complianceworxs.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, apikey, authorization',
};

function normalizeMarket(input) {
  if (typeof input !== 'string') return 'other';
  const v = input.toLowerCase().trim();
  if (['pharma', 'pharmaceutical', 'life_sciences', 'life-sciences'].includes(v)) return 'pharma';
  if (['food', 'fnb', 'f&b', 'food_and_beverage'].includes(v)) return 'food';
  if (['cosmetics', 'cosmetics_waitlist', 'cosmetic'].includes(v)) return 'cosmetics_waitlist';
  if (['multiple', 'multi', 'multiple fda-regulated markets'].includes(v)) return 'multiple';
  return 'other';
}

function marketLabel(m) {
  switch (m) {
    case 'pharma': return 'Pharmaceutical / Biologic / Medical Device';
    case 'food': return 'Food & Beverage (FSMA / HACCP)';
    case 'cosmetics_waitlist': return 'Cosmetics (waitlist — MoCRA)';
    case 'multiple': return 'Multiple FDA-regulated markets';
    default: return 'Other';
  }
}

function extractDomainFromUrl(url) {
  if (!url) return null;
  try {
    let cleaned = url.trim();
    if (!/^https?:\/\//i.test(cleaned)) cleaned = 'https://' + cleaned;
    const u = new URL(cleaned);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'trashmail.com', '10minutemail.com',
  'throwaway.email', 'temp-mail.org', 'tempmail.com', 'yopmail.com',
  'maildrop.cc', 'sharklasers.com', 'getnada.com', 'dispostable.com',
  'fakeinbox.com', 'tempinbox.com', 'emailondeck.com', 'mintemail.com',
]);

function looksLikeGibberish(s) {
  if (!s) return false;
  const clean = s.replace(/[^a-zA-Z]/g, '');
  if (clean.length < 8) return false;
  let caseChanges = 0;
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1]; const curr = clean[i];
    if ((prev === prev.toLowerCase() && curr === curr.toUpperCase()) ||
        (prev === prev.toUpperCase() && curr === curr.toLowerCase())) caseChanges++;
  }
  if (caseChanges / clean.length > 0.3) return true;
  const lower = clean.toLowerCase();
  const vowels = (lower.match(/[aeiou]/g) || []).length;
  if (vowels / lower.length < 0.20 && lower.length > 10) return true;
  if (s.length > 15 && !s.includes(' ') && !s.includes('-') && !s.includes('.')) {
    const hasDoubleVowel = /[aeiou]{2}/i.test(s);
    const hasCommonBigram = /(th|er|on|an|re|in|at|es|or|te|st|le|nd|ou|it|is|ed|nt|ha|se|ar|me|nc|en|hi|ro|ne|ea|ra|ce|li|ch|ll|be|ma|si|om|ur|ca|el|ta|la|ti|al|de|rt|ng|ec|co|sh|io|as|to|ie|ot|et|ss|nn)/i.test(s);
    if (!hasDoubleVowel && !hasCommonBigram) return true;
  }
  return false;
}

function isDisposableEmail(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return true;
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
  if (domain === 'gmail.com') {
    const local = email.split('@')[0];
    const dots = (local.match(/\./g) || []).length;
    if (dots >= 3 && local.length < 15) return true;
    if (/\.[0-9]+\.[0-9]+$/.test(local)) return true;
  }
  return false;
}

function scoreSpam(fields) {
  const reasons = [];
  let score = 0;
  if (fields.honeypot && fields.honeypot.trim().length > 0) return { score: 100, reasons: ['honeypot_filled'] };
  if (looksLikeGibberish(fields.full_name)) { score += 40; reasons.push('name_gibberish'); }
  if (fields.company && looksLikeGibberish(fields.company)) { score += 30; reasons.push('company_gibberish'); }
  if (fields.description && looksLikeGibberish(fields.description) && fields.description.length < 100) { score += 20; reasons.push('description_gibberish'); }
  if (fields.linkedin && !/^(https?:\/\/|linkedin\.com|www\.linkedin)/i.test(fields.linkedin)) {
    if (fields.linkedin.length > 10) { score += 20; reasons.push('linkedin_not_url'); }
  }
  if (isDisposableEmail(fields.email)) { score += 35; reasons.push('disposable_email'); }
  if (fields.full_name && !fields.full_name.includes(' ') && fields.full_name.length > 15) {
    score += 15; reasons.push('name_no_space_long');
  }
  return { score, reasons };
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
        client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET,
        refresh_token: GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token',
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

async function sendGmail(opts) {
  const { token, error: tokenErr } = await getGmailAccessToken();
  if (!token) return { ok: false, error: tokenErr ?? 'no token' };

  const boundary = `cwpartner_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const headers = [
    `From: "${opts.fromName}" <${opts.fromEmail}>`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (opts.replyTo) headers.push(`Reply-To: ${opts.replyTo}`);

  const message = [
    ...headers,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    opts.text || opts.html.replace(/<[^>]+>/g, ''),
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    opts.html,
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

function applicantAcknowledgmentHtml(fullName) {
  const firstName = fullName.split(' ')[0] || fullName;
  return `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #3A3A3A; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.6;">
<p>${firstName},</p>

<p>Got your partner application. Thanks for raising your hand.</p>

<p>Here's how the ComplianceWorxs Partner Program works in plain terms: consultants who refer clients to our decision defensibility platform get a share of the revenue those clients generate. The clients get a record that answers the question every inspector asks: who authorized this decision, on what evidence, and when.</p>

<p>Next steps on my end:</p>

<ol>
<li>I review your application personally (usually within 2 business days)</li>
<li>If it looks like a fit, I set up a 20-minute call to walk through what the partner structure looks like, how referrals are tracked, and what your clients get</li>
<li>If we both want to move forward, I send over the partner agreement and onboard you in the portal</li>
</ol>

<p>I'll be in touch either way.</p>

<p>In the meantime, if you want to see what the product actually looks like from a practitioner's perspective, this is the fastest read:</p>

<p><a href="https://complianceworxs.com/irr" style="color: #0A5F74; font-weight: 600;">The Inspection Response Record</a></p>

<p>Jon</p>

<p style="color: #888; font-size: 13px; margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px;">
Jon Nugent<br>
Founder, ComplianceWorxs<br>
<a href="https://complianceworxs.com" style="color: #888;">complianceworxs.com</a>
</p>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  try {
    const body = await req.json();
    const fullName = (body.full_name || body.fullName || '').toString().trim();
    const email = (body.email || '').toString().trim().toLowerCase();
    const company = (body.company || '').toString().trim();
    const role = (body.role || body.role_type || '').toString().trim();
    const primaryMarket = normalizeMarket(body.primary_market);
    const linkedin = (body.linkedin || body.linkedin_url || '').toString().trim();
    const companyUrlRaw = (body.company_url || body.companyUrl || body.company_website || body.website_url || '').toString().trim();
    const description = (body.description || body.client_base || '').toString().trim();
    const submissionSource = (body.source || 'partner_page').toString();
    const honeypot = (body.website || body.url_field || body._hp || '').toString().trim();

    if (!fullName || fullName.length < 2) {
      return new Response(JSON.stringify({ error: 'Full name is required.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'Valid email is required.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let companyUrl = companyUrlRaw;
    if (companyUrl && !/^https?:\/\//i.test(companyUrl)) {
      companyUrl = 'https://' + companyUrl;
    }
    const companyDomain = extractDomainFromUrl(companyUrl);

    const { score: spamScore, reasons: spamReasons } = scoreSpam({
      full_name: fullName, email, company, linkedin, description, honeypot,
    });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const isSpam = spamScore >= 50;

    const { data: application, error: insertError } = await supabase
      .from('partner_applications')
      .insert({
        full_name: fullName, email: email,
        company: company || null,
        company_url: companyUrl || null,
        role_type: role || null,
        linkedin_url: linkedin || null,
        client_base: description || null,
        primary_market: primaryMarket,
        status: isSpam ? 'spam' : 'pending',
      })
      .select('id, created_at')
      .single();

    if (insertError) {
      console.error('Failed to insert partner application:', insertError);
      return new Response(JSON.stringify({ error: 'Failed to save application.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (isSpam) {
      console.log(`Spam blocked: ${email} score=${spamScore} reasons=${spamReasons.join(',')}`);
      return new Response(JSON.stringify({
        ok: true, application_id: application.id, primary_market: primaryMarket,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (ATTIO_API_KEY) {
      try {
        const attioDescParts = [
          `Partner applicant · ${marketLabel(primaryMarket)} · ${role || 'Role not specified'}`,
        ];
        if (company) attioDescParts.push(`Company: ${company}`);
        if (companyUrl) attioDescParts.push(`Website: ${companyUrl}`);
        if (linkedin) attioDescParts.push(`LinkedIn: ${linkedin}`);

        const attioPayload = {
          data: {
            values: {
              email_addresses: [{ email_address: email }],
              name: [{
                first_name: fullName.split(' ')[0] || fullName,
                last_name: fullName.split(' ').slice(1).join(' ') || '',
              }],
              description: [{ value: attioDescParts.join(' · ') }],
            },
          },
        };

        await fetch('https://api.attio.com/v2/objects/people/records', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${ATTIO_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(attioPayload),
        });
      } catch (attioErr) { console.error('Attio sync failed (non-fatal):', attioErr); }
    }

    // Notify Jon (internal) via Gmail
    try {
      const websiteCell = companyUrl ? `<a href="${companyUrl}">${companyUrl}</a>` : '—';
      const linkedinCell = linkedin ? `<a href="${linkedin}">${linkedin}</a>` : '—';

      const html = `
        <h2>New Partner Application</h2>
        <p><strong>${fullName}</strong> has applied to the ComplianceWorxs Partner Program.</p>
        <table cellpadding="8" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
          <tr><td style="background:#F5F6F7;font-weight:600">Name</td><td>${fullName}</td></tr>
          <tr><td style="background:#F5F6F7;font-weight:600">Email</td><td><a href="mailto:${email}">${email}</a></td></tr>
          <tr><td style="background:#F5F6F7;font-weight:600">Company</td><td>${company || '—'}</td></tr>
          <tr><td style="background:#F5F6F7;font-weight:600">Company Website</td><td>${websiteCell}</td></tr>
          <tr><td style="background:#F5F6F7;font-weight:600">Role</td><td>${role || '—'}</td></tr>
          <tr><td style="background:#F5F6F7;font-weight:600;color:#0A4F62">Primary Market</td><td style="font-weight:600;color:#0A4F62">${marketLabel(primaryMarket)}</td></tr>
          <tr><td style="background:#F5F6F7;font-weight:600">LinkedIn</td><td>${linkedinCell}</td></tr>
          <tr><td style="background:#F5F6F7;font-weight:600;vertical-align:top">Client base</td><td>${description ? description.replace(/\n/g, '<br/>') : '—'}</td></tr>
          <tr><td style="background:#F5F6F7;font-weight:600">Application ID</td><td>${application.id}</td></tr>
          <tr><td style="background:#F5F6F7;font-weight:600">Spam score</td><td>${spamScore}/100 (clean)</td></tr>
        </table>
        <p style="margin-top:20px;font-size:13px;color:#6B7280">Submitted ${new Date(application.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' })} EST · Source: ${submissionSource}</p>
      `;
      const notifyResult = await sendGmail({
        fromName: NOTIFY_FROM_NAME, fromEmail: NOTIFY_FROM_EMAIL,
        to: NOTIFY_TO, replyTo: email,
        subject: `Partner application · ${marketLabel(primaryMarket)} · ${fullName}`,
        html,
      });
      if (!notifyResult.ok) console.error('Jon notify Gmail failed (non-fatal):', notifyResult.error);
    } catch (emailErr) { console.error('Notify Jon (non-fatal):', emailErr); }

    // Send acknowledgment to applicant via Gmail
    try {
      const ackResult = await sendGmail({
        fromName: APPLICANT_FROM_NAME, fromEmail: APPLICANT_FROM_EMAIL,
        to: email, replyTo: 'jon@complianceworxs.com',
        subject: `Got your partner application — next steps`,
        html: applicantAcknowledgmentHtml(fullName),
      });
      if (!ackResult.ok) console.error('Applicant ack Gmail failed (non-fatal):', ackResult.error);
    } catch (ackErr) {
      console.error('Applicant ack (non-fatal):', ackErr);
    }

    return new Response(JSON.stringify({
      ok: true, application_id: application.id, primary_market: primaryMarket,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('partner-application-notifier error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
