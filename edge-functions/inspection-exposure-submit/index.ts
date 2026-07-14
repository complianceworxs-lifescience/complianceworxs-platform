// inspection-exposure-submit v1 — May 7 2026
// Receives Inspection Exposure Snapshot submissions from co-branded partner pages.
// Writes to exposure_submissions, emails Jon + partner contact (if applicable),
// sends submitter confirmation. NOT a consulting intake — a structured exposure analysis intake.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GMAIL_CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const GMAIL_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const GMAIL_REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';

const FROM_EMAIL = 'jon@complianceworxs.com';
const JON_EMAIL = 'jon@complianceworxs.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, apikey, authorization',
};

// ---------- Gmail OAuth helpers ----------
async function getGmailAccessToken(): Promise<string> {
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
  const data = await res.json();
  if (!data.access_token) throw new Error('Gmail token refresh failed: ' + JSON.stringify(data));
  return data.access_token;
}

function encodeRFC2047(str: string): string {
  return '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(str))) + '?=';
}

async function sendGmail(to: string, subject: string, htmlBody: string, cc?: string) {
  const token = await getGmailAccessToken();
  const headers = [
    `From: ComplianceWorxs <${FROM_EMAIL}>`,
    `To: ${to}`,
  ];
  if (cc) headers.push(`Cc: ${cc}`);
  headers.push(`Subject: ${encodeRFC2047(subject)}`);
  headers.push('Content-Type: text/html; charset="UTF-8"');
  headers.push('MIME-Version: 1.0');
  const raw = headers.join('\r\n') + '\r\n\r\n' + htmlBody;
  const encoded = btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ---------- Internal notification email ----------
function buildInternalEmail(s: any, partner: any) {
  const partnerLine = partner
    ? `<tr><td><b>Partner</b></td><td>${partner.partner_code} \u00b7 ${partner.full_name} (${partner.company})</td></tr>`
    : `<tr><td><b>Partner</b></td><td><i>direct \u2014 no partner attribution</i></td></tr>`;
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 720px; margin: 0 auto; color: #1a1a1a;">
  <div style="background: #0A5F74; color: #fff; padding: 16px 20px; border-bottom: 3px solid #F7C51E;">
    <p style="margin: 0; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #F7C51E;">Inspection Exposure Submission</p>
    <h2 style="margin: 4px 0 0; font-family: Georgia, serif; font-size: 22px;">${s.decision_type} \u00b7 ${s.email}</h2>
  </div>
  <div style="padding: 20px; background: #F8FAFC; border: 1px solid #E2E8F0; border-top: none;">
    <table style="width:100%; border-collapse:collapse; font-size: 14px;">
      <tr><td style="padding: 6px 0; width: 30%;"><b>Submission ID</b></td><td>${s.id}</td></tr>
      <tr><td style="padding: 6px 0;"><b>Submitter</b></td><td>${s.full_name || '<i>not given</i>'} \u00b7 ${s.email}</td></tr>
      <tr><td style="padding: 6px 0;"><b>Company</b></td><td>${s.company || '<i>not given</i>'}</td></tr>
      <tr><td style="padding: 6px 0;"><b>Role</b></td><td>${s.role || '<i>not given</i>'}</td></tr>
      <tr><td style="padding: 6px 0;"><b>Decision Type</b></td><td>${s.decision_type}</td></tr>
      <tr><td style="padding: 6px 0;"><b>Framework</b></td><td>${s.regulatory_framework || '<i>not given</i>'}</td></tr>
      ${partnerLine}
      <tr><td style="padding: 6px 0;"><b>Source page</b></td><td>${s.source_page || '<i>not given</i>'}</td></tr>
    </table>
  </div>
  <div style="padding: 24px 20px; background: #fff; border: 1px solid #E2E8F0; border-top: none;">
    <h3 style="font-family: Georgia, serif; color: #0A5F74; margin: 0 0 6px;">What decision was authorized?</h3>
    <p style="white-space: pre-wrap; font-size: 14px; line-height: 1.6; margin: 0 0 22px;">${s.decision_authorized}</p>
    <h3 style="font-family: Georgia, serif; color: #0A5F74; margin: 0 0 6px;">What evidence supported the authorization?</h3>
    <p style="white-space: pre-wrap; font-size: 14px; line-height: 1.6; margin: 0 0 22px;">${s.evidence_supporting}</p>
    <h3 style="font-family: Georgia, serif; color: #0A5F74; margin: 0 0 6px;">What would an investigator see in the record today?</h3>
    <p style="white-space: pre-wrap; font-size: 14px; line-height: 1.6; margin: 0 0 22px;">${s.investigator_view}</p>
    ${s.supporting_document_url ? `<p style="font-size: 13px;"><b>Supporting document:</b> <a href="${s.supporting_document_url}">${s.supporting_document_url}</a></p>` : ''}
  </div>
  <div style="padding: 16px 20px; background: #F8FAFC; border: 1px solid #E2E8F0; border-top: none; font-size: 12px; color: #5A6472;">
    Action: review submission \u2192 generate Inspection Exposure Snapshot \u2192 deliver to ${s.email}.<br/>
    ${partner ? `Cc partner contact (${partner.email}) on snapshot delivery so partner sees the result.` : ''}
  </div>
</div>`;
}

// ---------- Submitter confirmation email ----------
function buildSubmitterEmail(s: any) {
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; color: #1a1a1a;">
  <div style="background: #0A5F74; color: #fff; padding: 22px 24px; border-bottom: 3px solid #F7C51E;">
    <p style="margin: 0; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #F7C51E;">Submission Received</p>
    <h1 style="margin: 6px 0 0; font-family: Georgia, serif; font-size: 24px; line-height: 1.25;">Your decision has been submitted for inspection exposure analysis.</h1>
  </div>
  <div style="padding: 28px 24px; background: #fff;">
    <p style="font-size: 15px; line-height: 1.65; margin: 0 0 16px;">
      ComplianceWorxs evaluates whether the authorization basis behind the decision is reconstructable from the record alone under regulatory scrutiny.
    </p>
    <p style="font-size: 15px; line-height: 1.65; margin: 0 0 24px;">
      If critical exposure gaps are identified, you will receive the specific authorization deficiencies and the associated inspection risk patterns.
    </p>
    <table style="width:100%; border-collapse:collapse; background: #F8FAFC; border-left: 3px solid #F7C51E; padding: 0;">
      <tr><td style="padding: 14px 18px; font-size: 13px;">
        <p style="margin: 0 0 4px; color: #5A6472; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;">Submission reference</p>
        <p style="margin: 0; font-family: monospace; color: #0A5F74; font-size: 14px;">${s.id}</p>
        <p style="margin: 10px 0 0; color: #5A6472; font-size: 12px;">Decision type: ${s.decision_type}</p>
      </td></tr>
    </table>
    <p style="font-size: 13px; line-height: 1.6; color: #5A6472; margin: 24px 0 0;">
      Jon Nugent, Founder<br/>ComplianceWorxs
    </p>
  </div>
</div>`;
}

// ---------- Main handler ----------
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const email = (body.email || '').toString().trim().toLowerCase();
    const decisionType = (body.decision_type || '').toString().trim();
    const decisionAuthorized = (body.decision_authorized || '').toString().trim();
    const evidenceSupporting = (body.evidence_supporting || '').toString().trim();
    const investigatorView = (body.investigator_view || '').toString().trim();

    // Validate required fields
    if (!email || !decisionType || !decisionAuthorized || !evidenceSupporting || !investigatorView) {
      return new Response(JSON.stringify({
        ok: false, error: 'missing_required_fields',
        message: 'Email, decision type, decision authorized, evidence supporting, and investigator view are all required.'
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!email.includes('@')) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_email' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const partnerCode = (body.partner_code || '').toString().trim().toUpperCase() || null;

    // Look up partner if code provided (for CC on internal email)
    let partner: any = null;
    if (partnerCode) {
      const { data: p } = await supabase
        .from('partners')
        .select('partner_code, full_name, email, company, status')
        .ilike('partner_code', partnerCode)
        .maybeSingle();
      if (p && p.status === 'active') partner = p;
    }

    // Insert submission
    const submission = {
      email,
      full_name: (body.full_name || '').toString().trim() || null,
      company: (body.company || '').toString().trim() || null,
      role: (body.role || '').toString().trim() || null,
      decision_type: decisionType,
      regulatory_framework: (body.regulatory_framework || '').toString().trim() || null,
      decision_authorized: decisionAuthorized,
      evidence_supporting: evidenceSupporting,
      investigator_view: investigatorView,
      supporting_document_url: (body.supporting_document_url || '').toString().trim() || null,
      partner_code: partner ? partner.partner_code : null,
      source_page: (body.source_page || '').toString().trim() || null,
      status: 'received',
    };

    const { data: row, error: insertError } = await supabase
      .from('exposure_submissions')
      .insert(submission)
      .select()
      .single();

    if (insertError) {
      console.error('exposure_submissions insert failed:', insertError);
      return new Response(JSON.stringify({ ok: false, error: 'db_insert_failed', detail: insertError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Send internal notification (Jon + partner CC if applicable)
    try {
      const subject = `[Exposure Submission] ${row.decision_type} \u00b7 ${row.email}${partner ? ` \u00b7 ${partner.partner_code}` : ''}`;
      await sendGmail(
        JON_EMAIL,
        subject,
        buildInternalEmail(row, partner),
        partner ? partner.email : undefined
      );
    } catch (e) {
      console.error('Internal notification email failed:', e);
    }

    // Send submitter confirmation
    try {
      await sendGmail(
        row.email,
        'Submission received \u2014 Inspection Exposure Analysis',
        buildSubmitterEmail(row)
      );
    } catch (e) {
      console.error('Submitter confirmation email failed:', e);
    }

    return new Response(JSON.stringify({
      ok: true,
      submission_id: row.id,
      message: 'Submission received. Confirmation sent to ' + row.email + '.',
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('inspection-exposure-submit error:', err);
    return new Response(JSON.stringify({ ok: false, error: 'server_error', detail: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
