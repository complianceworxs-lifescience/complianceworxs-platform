// resource-download-send v5
//
// Captures email from theinspectionrecord.com /resources page,
// emails the download link via Gmail API,
// records the lead in Attio (download history appended to next_action).
//
// POST body: { email: string, resource_slug: string }
//
// v5:
// - Append download history to Attio next_action (don't overwrite).
// - Remove Supabase form_submissions write — tracking lives in Attio only.
// - external_url for two new TIR resources hosted directly in Vercel public/.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── ENV ──
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE          = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ATTIO_API_KEY         = Deno.env.get('ATTIO_API_KEY') ?? '';
const GMAIL_CLIENT_ID       = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const GMAIL_CLIENT_SECRET   = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const GMAIL_REFRESH_TOKEN   = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';

// ── CONSTANTS ──
const FROM_NAME      = 'Jon Nugent';
const FROM_EMAIL     = 'jon@complianceworxs.com';
const REPLY_TO       = 'jon@complianceworxs.com';
const BUCKET         = 'Case Files';
const SIGNED_EXPIRY  = 60 * 60 * 24 * 90; // 90 days
const SUPPORT_EMAIL  = 'jon@complianceworxs.com';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

type Resource = {
  filename?: string;
  external_url?: string;
  display_name: string;
  short_label: string;
  description: string;
};

// ── RESOURCE CATALOG ──
const RESOURCES: Record<string, Resource> = {
  'batch-release-authorization-record-template': {
    filename: 'templates/CW-Batch-Release-Authorization-Record-Template.pdf',
    display_name: 'Batch Release Authorization Record Template',
    short_label: 'Batch Release Template',
    description: 'A structured template for producing a batch release authorization record at the time of the release decision. Pre-populated with the five required elements and the CFR citations that govern the release determination.',
  },
  '5-element-authorization-structure': {
    external_url: 'https://theinspectionrecord.com/CW-5-Element-Authorization-Structure.pdf',
    display_name: 'The 5-Element Authorization Structure Investigators Expect to See',
    short_label: '5-Element Framework',
    description: 'A reference framework defining the five elements that, taken together, render a regulated decision defensible under direct regulatory scrutiny — and the absence of which is what most 483 observations actually cite.',
  },
  'inspection-prep-checklist-batch-release': {
    external_url: 'https://theinspectionrecord.com/CW-Inspection-Prep-Checklist-Batch-Release.pdf',
    display_name: 'Inspection Prep Checklist — Batch Release Authorization',
    short_label: 'Batch Release Inspection Prep',
    description: 'A pre-inspection review checklist for batch release files. Identifies the three questions an FDA investigator most consistently asks about any batch released under an open or qualified deviation, and maps each question to the specific documentation that must exist in the file.',
  },
};

// ── HELPERS ──
function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const t = email.trim();
  if (t.length < 5 || t.length > 254) return false;
  return /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(t);
}

async function getGmailAccessToken(): Promise<{ ok: boolean; access_token?: string; error?: string }> {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    return { ok: false, error: 'gmail_credentials_missing' };
  }
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
    if (!r.ok) {
      const body = await r.text();
      return { ok: false, error: `oauth_${r.status}: ${body.slice(0, 200)}` };
    }
    const j = await r.json();
    return { ok: true, access_token: j.access_token };
  } catch (e) {
    return { ok: false, error: `oauth_exception: ${(e as Error).message}` };
  }
}

function buildRawMime(opts: {
  to: string;
  to_name: string;
  subject: string;
  html: string;
  text: string;
}): string {
  const messageId = `<${crypto.randomUUID()}@complianceworxs.com>`;
  const boundary = `b_${crypto.randomUUID().replace(/-/g, '')}`;
  const encodedSubject = /[^\x20-\x7E]/.test(opts.subject)
    ? `=?UTF-8?B?${btoa(unescape(encodeURIComponent(opts.subject)))}?=`
    : opts.subject;

  const lines = [
    `From: "${FROM_NAME}" <${FROM_EMAIL}>`,
    `To: "${opts.to_name}" <${opts.to}>`,
    `Reply-To: ${REPLY_TO}`,
    `Subject: ${encodedSubject}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    opts.text,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    opts.html,
    ``,
    `--${boundary}--`,
    ``,
  ];
  const raw = lines.join('\r\n');
  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendViaGmail(accessToken: string, opts: {
  to: string;
  to_name: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; message_id?: string; error?: string }> {
  try {
    const raw = buildRawMime(opts);
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: `gmail_${r.status}: ${text.slice(0, 200)}` };
    const j = JSON.parse(text);
    return { ok: true, message_id: j.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function buildHtml(opts: { displayName: string; description: string; signedUrl: string }): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F5F6F7;">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#1F2933;background:#FFFFFF;">

<p style="font-size:15px;line-height:1.65;margin:0 0 18px 0;">Hi,</p>

<p style="font-size:15px;line-height:1.65;margin:0 0 18px 0;">
Your copy of the <strong>${opts.displayName}</strong> is ready. The download link is below.
</p>

<p style="margin:0 0 28px 0;">
  <a href="${opts.signedUrl}" style="display:inline-block;background:#0A5F74;color:#FFFFFF;text-decoration:none;padding:13px 26px;font-weight:600;font-size:14px;border-radius:6px;letter-spacing:0.01em;">
    Download (PDF)
  </a>
</p>

<p style="font-size:13px;line-height:1.6;margin:0 0 6px 0;color:#6B7B8D;">
If the button doesn't work, paste this into your browser:
</p>
<p style="font-size:12px;line-height:1.55;margin:0 0 24px 0;color:#6B7B8D;word-break:break-all;">
<a href="${opts.signedUrl}" style="color:#0A5F74;text-decoration:underline;">${opts.signedUrl}</a>
</p>

<hr style="border:none;border-top:1px solid #E2E6EA;margin:24px 0;">

<p style="font-size:14px;line-height:1.7;margin:0 0 16px 0;">
${opts.description}
</p>

<p style="font-size:14px;line-height:1.7;margin:0 0 16px 0;">
More inspection-ready resources are coming. You'll receive each one as it's released. Reply to this email if there's a specific decision type you want to see covered.
</p>

<hr style="border:none;border-top:1px solid #E2E6EA;margin:24px 0;">

<p style="font-size:14px;line-height:1.6;margin:0 0 4px 0;">Jon Nugent</p>
<p style="font-size:13px;line-height:1.6;margin:0 0 4px 0;color:#6B7B8D;">Founder, ComplianceWorxs</p>
<p style="font-size:13px;line-height:1.6;margin:0;color:#6B7B8D;">complianceworxs.com</p>

<hr style="border:none;border-top:1px solid #E2E6EA;margin:24px 0 16px 0;">

<p style="font-size:11px;line-height:1.6;margin:0 0 12px 0;color:#9DA8B3;font-style:italic;">
ComplianceWorxs does not make, approve, or recommend regulatory decisions. All determinations remain the sole responsibility of the regulated organization. Use of this resource does not constitute legal, regulatory, or compliance counsel.
</p>

<p style="font-size:11px;line-height:1.5;margin:0;color:#9DA8B3;">
Trouble with the download? Email <a href="mailto:${SUPPORT_EMAIL}" style="color:#0A5F74;">${SUPPORT_EMAIL}</a>.
</p>

</div>
</body></html>`;
}

function buildText(opts: { displayName: string; description: string; signedUrl: string }): string {
  return `Hi,

Your copy of the ${opts.displayName} is ready. The download link is below.

Download:
${opts.signedUrl}

${opts.description}

More inspection-ready resources are coming. You'll receive each one as it's released. Reply to this email if there's a specific decision type you want to see covered.

Jon Nugent
Founder, ComplianceWorxs
complianceworxs.com

--
ComplianceWorxs does not make, approve, or recommend regulatory decisions. All determinations remain the sole responsibility of the regulated organization. Use of this resource does not constitute legal, regulatory, or compliance counsel.

Trouble with the download? Email ${SUPPORT_EMAIL}.
`;
}

// ── ATTIO ──

async function attioFindPersonByEmail(email: string): Promise<{ record_id: string | null; next_action: string | null }> {
  if (!ATTIO_API_KEY) return { record_id: null, next_action: null };
  try {
    const r = await fetch('https://api.attio.com/v2/objects/people/records/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ATTIO_API_KEY}`,
      },
      body: JSON.stringify({
        filter: {
          email_addresses: { email_address: email },
        },
        limit: 1,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return { record_id: null, next_action: null };
    const j = await r.json();
    const record = j?.data?.[0];
    if (!record) return { record_id: null, next_action: null };
    const recordId = record?.id?.record_id ?? null;
    const naField = record?.values?.next_action;
    const naValue = Array.isArray(naField) && naField[0]?.value ? naField[0].value : null;
    return { record_id: recordId, next_action: naValue };
  } catch (e) {
    console.error('attio find failed:', (e as Error).message);
    return { record_id: null, next_action: null };
  }
}

function buildAppendedNextAction(existing: string | null, shortLabel: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const newEntry = `${shortLabel} (${today})`;

  if (!existing) {
    return `TIR resources downloaded: ${newEntry}. Monitor for engagement.`;
  }

  // If the existing next_action already tracks downloads, append to that list.
  const downloadsMatch = existing.match(/^TIR resources downloaded: (.+?)\. Monitor for engagement\.$/);
  if (downloadsMatch) {
    const list = downloadsMatch[1];
    // Check if this short_label is already in the list (different date is fine, but avoid pure duplicates from same day)
    if (list.includes(`${shortLabel} (${today})`)) {
      return existing; // exact duplicate today, no change
    }
    return `TIR resources downloaded: ${list}; ${newEntry}. Monitor for engagement.`;
  }

  // Otherwise prepend the downloads tracker, preserving the existing next_action below.
  return `TIR resources downloaded: ${newEntry}. Monitor for engagement. | Prior: ${existing}`;
}

async function attioUpsertWithDownload(email: string, resource_slug: string, shortLabel: string) {
  if (!ATTIO_API_KEY) return null;

  const { next_action: existingNextAction } = await attioFindPersonByEmail(email);
  const newNextAction = buildAppendedNextAction(existingNextAction, shortLabel);

  try {
    const r = await fetch('https://api.attio.com/v2/objects/people/records', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ATTIO_API_KEY}`,
      },
      body: JSON.stringify({
        data: {
          values: {
            email_addresses: [{ email_address: email }],
            lifecycle_stage: 'Contact',
            capture_source:  `tir-resource:${resource_slug}`,
            next_action:     newNextAction,
          },
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) {
      const j = await r.json();
      return j?.data?.id?.record_id ?? null;
    } else {
      const errText = await r.text();
      console.error('attio upsert non-ok:', r.status, errText.slice(0, 200));
    }
  } catch (e) {
    console.error('attio upsert exception:', (e as Error).message);
  }
  return null;
}

// ── HANDLER ──
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let body: { email?: string; resource_slug?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const resource_slug = (body.resource_slug ?? 'batch-release-authorization-record-template').trim();

  if (!isValidEmail(email)) {
    return new Response(JSON.stringify({ error: 'invalid_email' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const resource = RESOURCES[resource_slug];
  if (!resource) {
    return new Response(JSON.stringify({ error: 'unknown_resource', resource_slug }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const isInternal = email.endsWith('@complianceworxs.com') || email.endsWith('@theinspectionrecord.com');

  let downloadUrl: string;

  if (resource.external_url) {
    downloadUrl = resource.external_url;
  } else if (resource.filename) {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signed, error: signErr } = await supabase
      .storage
      .from(BUCKET)
      .createSignedUrl(resource.filename, SIGNED_EXPIRY);

    if (signErr || !signed?.signedUrl) {
      console.error('signed url failed:', signErr?.message);
      return new Response(JSON.stringify({
        ok: false,
        error: 'signed_url_failed',
        detail: signErr?.message ?? 'no signed url returned',
        bucket: BUCKET,
        filename: resource.filename,
      }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    downloadUrl = signed.signedUrl;
  } else {
    return new Response(JSON.stringify({ error: 'resource_misconfigured', resource_slug }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Track in Attio (download history appended to next_action)
  let attio_record_id: string | null = null;
  try {
    attio_record_id = await attioUpsertWithDownload(email, resource_slug, resource.short_label);
  } catch (e) {
    console.error('attio upsert exception:', (e as Error).message);
  }

  const subject = `Your copy: ${resource.display_name}`;
  const html = buildHtml({
    displayName: resource.display_name,
    description: resource.description,
    signedUrl: downloadUrl,
  });
  const text = buildText({
    displayName: resource.display_name,
    description: resource.description,
    signedUrl: downloadUrl,
  });

  let emailSent = false;
  let emailError: string | null = null;
  let messageId: string | null = null;

  if (!isInternal) {
    const auth = await getGmailAccessToken();
    if (!auth.ok) {
      emailError = auth.error ?? 'oauth_failed';
    } else {
      const result = await sendViaGmail(auth.access_token!, {
        to: email,
        to_name: email.split('@')[0],
        subject,
        html,
        text,
      });
      emailSent = result.ok;
      emailError = result.error ?? null;
      messageId = result.message_id ?? null;
    }
  } else {
    emailSent = true;
    emailError = 'skipped_internal_address';
  }

  return new Response(JSON.stringify({
    ok: true,
    email_sent: emailSent,
    email_error: emailError,
    message_id: messageId,
    attio_record_id,
    resource_slug,
  }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
