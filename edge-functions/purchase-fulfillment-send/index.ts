// purchase-fulfillment-send v3 — Gmail transport
// v2→v3: replaced Resend with the same Gmail OAuth transport the outbound
// sender uses (CW does not use Resend). Also corrected retired "DDR" copy to
// current canon. Everything else (signed URL, slug map, order update) unchanged.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Gmail OAuth transport (same secrets the outbound sender uses)
const GMAIL_CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const GMAIL_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const GMAIL_REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';
const FROM_NAME     = 'ComplianceWorxs';
const FROM_EMAIL    = 'jon@complianceworxs.com';
const REPLY_TO      = 'jon@complianceworxs.com';
const DELIVERY_BCC  = 'jon@complianceworxs.com';
const SUPPORT_EMAIL = 'support@complianceworxs.com';
const SIGNED_EXPIRY = 60 * 60 * 24 * 90; // 90 days

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, apikey, authorization',
};

const SLUG_TO_PDF: Record<string, { filename: string; scenario_name: string; cf_number: string }> = {
  'process-validation':         { filename: 'CW-Case-File-01-Process-Validation-Conclusion.pdf',         scenario_name: 'Process Validation Conclusion',          cf_number: 'CF01' },
  'process-validation-conclusion': { filename: 'CW-Case-File-01-Process-Validation-Conclusion.pdf',      scenario_name: 'Process Validation Conclusion',          cf_number: 'CF01' },
  'batch-release-authorization':{ filename: 'CW-Case-File-02-Batch-Release-Authorization.pdf',           scenario_name: 'Batch Release Authorization',            cf_number: 'CF02' },
  'batch-release':              { filename: 'CW-Case-File-02-Batch-Release-Authorization.pdf',           scenario_name: 'Batch Release Authorization',            cf_number: 'CF02' },
  'oos-investigation':          { filename: 'CW-Case-File-03-OOS-Investigation-Closure.pdf',             scenario_name: 'OOS Investigation Closure',              cf_number: 'CF03' },
  'deviation-risk-assessment':  { filename: 'CW-Case-File-04-Deviation-Risk-Assessment.pdf',             scenario_name: 'Deviation Risk Assessment',              cf_number: 'CF04' },
  'deviation-root-cause':       { filename: 'CW-Case-File-04-Deviation-Risk-Assessment.pdf',             scenario_name: 'Deviation Risk Assessment',              cf_number: 'CF04' },
  'change-control-risk':        { filename: 'CW-Case-File-05-Change-Control-Approval.pdf',               scenario_name: 'Change Control Approval',                cf_number: 'CF05' },
  'change-control':             { filename: 'CW-Case-File-05-Change-Control-Approval.pdf',               scenario_name: 'Change Control Approval',                cf_number: 'CF05' },
  'capa-effectiveness':         { filename: 'CW-Case-File-06-CAPA-Effectiveness-Decision.pdf',           scenario_name: 'CAPA Effectiveness Decision',            cf_number: 'CF06' },
  'data-integrity':             { filename: 'CW-Case-File-07-Data-Integrity-Investigation.pdf',          scenario_name: 'Data Integrity Investigation',           cf_number: 'CF07' },
  'supplier-qualification':     { filename: 'CW-Case-File-08-Supplier-Qualification-Exception.pdf',      scenario_name: 'Supplier Qualification Exception',       cf_number: 'CF08' },
  'stability-oot':              { filename: 'CW-Case-File-09-Stability-OOT-Evaluation.pdf',              scenario_name: 'Stability OOT Evaluation',               cf_number: 'CF09' },
  'complaint-investigation':    { filename: 'CW-Case-File-10-Complaint-Investigation-Disposition.pdf',   scenario_name: 'Complaint Investigation Disposition',    cf_number: 'CF10' },
};

const BUCKET = 'Case Files';

function getProductInfo(slug: string, sku: string) {
  const direct = SLUG_TO_PDF[slug];
  if (direct) return direct;
  if (sku === 'CF-CASE-FILE') {
    return null;
  }
  return null;
}

function buildEmailHtml(opts: {
  firstName: string | null;
  scenarioName: string;
  cfNumber: string;
  signedUrl: string;
}): string {
  const { firstName, scenarioName, cfNumber, signedUrl } = opts;
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1C2733;">

<p style="font-size:16px;line-height:1.6;margin:0 0 20px 0;">${greeting}</p>

<p style="font-size:16px;line-height:1.6;margin:0 0 18px 0;">
Your <strong>${scenarioName}</strong> case file is ready. The download link is below.
</p>

<p style="font-size:16px;line-height:1.6;margin:0 0 28px 0;">
This is the inspection-grade record format. Investigators expect to find this structure when they ask who authorized a compliance decision and on what evidence. The reference record inside is fully populated &mdash; named decision owner, evidence anchored to source records, alternatives evaluated and rejected, ICH Q9 risk evaluation, temporal sequencing, authority validation. Apply the structure to your next ${scenarioName.toLowerCase()}.
</p>

<p style="margin:0 0 28px 0;">
  <a href="${signedUrl}" style="display:inline-block;background:#0E6F86;color:#FFFFFF;text-decoration:none;padding:14px 28px;font-weight:600;font-size:15px;border-radius:6px;letter-spacing:0.02em;">
    Download case file (PDF)
  </a>
</p>

<p style="font-size:13px;line-height:1.6;margin:0 0 8px 0;color:#5E6B75;">
If the button doesn't work, paste this into your browser:
</p>
<p style="font-size:12px;line-height:1.5;margin:0 0 24px 0;color:#5E6B75;word-break:break-all;">
${signedUrl}
</p>

<hr style="border:none;border-top:1px solid #E5E5E5;margin:28px 0;">

<p style="font-size:14px;line-height:1.6;margin:0 0 16px 0;">
The link is valid for 90 days. If you need it after that, reply to this email and we'll send a fresh one.
</p>

<p style="font-size:14px;line-height:1.6;margin:0 0 16px 0;">
The case file is structured as a controlled document &mdash; doc ID, revision, page numbering, citation alignment, signature block. It's meant to function as a reference artifact, not a marketing piece. Use it the way you'd use any other regulatory reference: open to the relevant section, apply the structure to your own decision, document accordingly.
</p>

<div style="background:#F7F5F0;border-left:3px solid #1E6F73;padding:14px 18px;margin:24px 0;border-radius:2px;">
<p style="font-size:13px;line-height:1.55;margin:0;color:#1C2733;">
<strong>Trouble downloading?</strong> If the link above doesn't work or you don't see the case file, email <a href="mailto:${SUPPORT_EMAIL}" style="color:#1E6F73;text-decoration:underline;">${SUPPORT_EMAIL}</a> and we'll get it to you directly.
</p>
</div>

<hr style="border:none;border-top:1px solid #E5E5E5;margin:28px 0;">

<p style="font-size:14px;line-height:1.6;margin:0 0 2px 0;">&mdash; ComplianceWorxs</p>
<p style="font-size:13px;line-height:1.6;margin:0;color:#5E6B75;">The Record Behind the Decision &middot; complianceworxs.com</p>
<p style="font-size:11px;line-height:1.5;margin:14px 0 0 0;color:#9CA3AF;letter-spacing:0.04em;">Reference: ${cfNumber}</p>

</div>`;
}

async function getGmailAccessToken(): Promise<string | null> {
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
    return (await r.json())?.access_token ?? null;
  } catch { return null; }
}

function buildRawHtmlEmail(toEmail: string, subject: string, html: string): string {
  const messageId = `<${crypto.randomUUID()}@complianceworxs.com>`;
  const encodedSubject = /[^\x20-\x7E]/.test(subject)
    ? `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`
    : subject;
  const lines = [
    `From: "${FROM_NAME}" <${FROM_EMAIL}>`,
    `To: <${toEmail}>`,
    `Bcc: ${DELIVERY_BCC}`,
    `Reply-To: ${REPLY_TO}`,
    `Subject: ${encodedSubject}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    html,
  ];
  const raw = lines.join('\r\n');
  return btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const email = (body.email ?? '').toString().trim().toLowerCase();
  const productSku = (body.product_sku ?? '').toString().trim();
  const productSlug = (body.product_slug ?? '').toString().trim().toLowerCase();
  const customerName = body.customer_name ? body.customer_name.toString().trim() : null;
  const firstName = customerName ? customerName.split(' ')[0] : null;
  const orderId = body.order_id ?? null;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'invalid_email' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  if (!productSlug && !productSku) {
    return new Response(JSON.stringify({ error: 'missing_product_identifier' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const productInfo = getProductInfo(productSlug, productSku);
  if (!productInfo) {
    return new Response(JSON.stringify({ error: 'unknown_product', slug: productSlug, sku: productSku }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: signed, error: signErr } = await supabase
    .storage
    .from(BUCKET)
    .createSignedUrl(productInfo.filename, SIGNED_EXPIRY);

  if (signErr || !signed?.signedUrl) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'signed_url_failed',
      detail: signErr?.message ?? 'no signed url returned',
      bucket: BUCKET,
      filename: productInfo.filename,
    }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const signedUrl = signed.signedUrl;
  const subject = `Your case file: ${productInfo.scenario_name}`;
  const html = buildEmailHtml({
    firstName,
    scenarioName: productInfo.scenario_name,
    cfNumber: productInfo.cf_number,
    signedUrl,
  });

  let emailSent = false;
  let emailError: string | null = null;
  let gmailId: string | null = null;

  const token = await getGmailAccessToken();
  if (!token) {
    emailError = 'gmail_token_failed';
  } else {
    try {
      const raw = buildRawHtmlEmail(email, subject, html);
      const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) { emailSent = true; gmailId = (await r.json())?.id ?? null; }
      else { emailError = `gmail_${r.status}: ${(await r.text()).slice(0, 200)}`; }
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e);
    }
  }

  try {
    await supabase.from('events').insert({
      session_id: `purchase:${email}`,
      event_name: 'case_file_delivered',
      page: `/case-files/${productSlug}`,
      properties: {
        email,
        product_sku: productSku,
        product_slug: productSlug,
        cf_number: productInfo.cf_number,
        scenario_name: productInfo.scenario_name,
        order_id: orderId,
        email_sent: emailSent,
        email_error: emailError,
        gmail_message_id: gmailId,
        provider: 'gmail',
        filename: productInfo.filename,
      },
    });
  } catch (e) {
    console.error('events insert failed:', e);
  }

  if (orderId && emailSent) {
    try {
      await supabase.from('orders').update({
        metadata: {
          fulfilled_at: new Date().toISOString(),
          fulfillment_email_sent: true,
          fulfillment_gmail_message_id: gmailId,
          fulfillment_signed_url_expires_at: new Date(Date.now() + SIGNED_EXPIRY * 1000).toISOString(),
        },
        updated_at: new Date().toISOString(),
      }).eq('id', orderId);
    } catch (e) {
      console.error('order metadata update failed:', e);
    }
  }

  return new Response(JSON.stringify({
    ok: emailSent,
    email_sent: emailSent,
    email,
    product_slug: productSlug,
    cf_number: productInfo.cf_number,
    scenario_name: productInfo.scenario_name,
    signed_url: signedUrl,
    signed_url_expires_in_seconds: SIGNED_EXPIRY,
    gmail_message_id: gmailId,
    provider: 'gmail',
    error: emailError,
  }), {
    status: emailSent ? 200 : 500,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
