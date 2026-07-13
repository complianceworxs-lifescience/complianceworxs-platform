import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const ADMIN_SECRET = Deno.env.get('DDR_ADMIN_SECRET') ?? '';
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET_DDR') ?? '';

const DEFAULT_VALIDITY_DAYS = 365;
const EMAIL_FROM = 'ComplianceWorxs <noreply@complianceworxs.com>';

const DDR_LINKS = {
  deviation: '/ddr/deviation-root-cause',
  capa: '/ddr/capa-closure',
  batch: '/ddr/batch-release',
};
const SITE_BASE = 'https://cases.complianceworxs.com';

// Strict filter: only issue DDR tokens when this specific product is purchased.
const DDR_BUNDLE_PRODUCT_ID = 'prod_UH20dye2FJiptP';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, apikey, authorization, x-admin-secret, stripe-signature',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function formatExpiry(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Verify Stripe webhook signature.
 * Stripe signs the raw request body with HMAC-SHA256 using the webhook secret.
 * The signature header looks like: t=1234567890,v1=abc123def456...
 */
async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  if (!sigHeader || !secret) return false;

  const parts = sigHeader.split(',');
  let timestamp = '';
  const signatures: string[] = [];
  for (const part of parts) {
    const [k, v] = part.split('=');
    if (k === 't') timestamp = v;
    else if (k === 'v1') signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return false;

  // Reject timestamps older than 5 minutes (replay protection)
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const sigHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison against any v1 signature in the header
  return signatures.some((s) => timingSafeEqual(s, sigHex));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Check whether the checkout session contains the DDR bundle product.
 * Stripe's checkout.session.completed event does NOT include line_items by default;
 * we have to fetch them from the Stripe API using the session ID.
 */
async function sessionContainsDdrBundle(sessionId: string): Promise<boolean> {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) {
    console.warn('STRIPE_SECRET_KEY missing — cannot verify product; allowing token issuance as fallback');
    return true;
  }
  try {
    const res = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items?limit=100&expand[]=data.price.product`,
      { headers: { 'Authorization': `Bearer ${stripeKey}` } }
    );
    if (!res.ok) {
      console.warn('Stripe line_items fetch failed:', res.status);
      return false;
    }
    const data = await res.json();
    const items = data.data || [];
    for (const item of items) {
      const product = item.price?.product;
      const productId = typeof product === 'string' ? product : product?.id;
      if (productId === DDR_BUNDLE_PRODUCT_ID) return true;
    }
    return false;
  } catch (err) {
    console.error('Error fetching line items:', err);
    return false;
  }
}

async function sendAccessEmail(email: string, fullName: string | null, token: string, expiresAt: string, source: string) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY missing, skipping access email');
    return;
  }

  const greeting = fullName ? `Hi ${fullName.split(' ')[0]},` : 'Hi,';
  const sourceNote = source === 'stripe'
    ? 'Your purchase of the Complete Authorization Package is confirmed.'
    : 'Complimentary access has been granted to the ComplianceWorxs Decision Defense Records.';

  const html = `
    <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 560px; margin: 0 auto; color: #3A3A3A;">
      <p style="font-size: 16px; line-height: 1.6;">${greeting}</p>
      <p style="font-size: 16px; line-height: 1.6;">${sourceNote} Your three Decision Defense Records are ready.</p>
      <div style="margin: 32px 0; padding: 24px; background: #F5F6F7; border-left: 3px solid #0E6F86;">
        <p style="margin: 0 0 16px; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: #0A5F74; font-weight: 600;">Your Decision Defense Records</p>
        <p style="margin: 10px 0;"><a href="${SITE_BASE}${DDR_LINKS.deviation}?t=${token}" style="color: #0E6F86; text-decoration: none; font-weight: 600;">→ Deviation Root Cause DDR</a></p>
        <p style="margin: 10px 0;"><a href="${SITE_BASE}${DDR_LINKS.capa}?t=${token}" style="color: #0E6F86; text-decoration: none; font-weight: 600;">→ CAPA Closure DDR</a></p>
        <p style="margin: 10px 0;"><a href="${SITE_BASE}${DDR_LINKS.batch}?t=${token}" style="color: #0E6F86; text-decoration: none; font-weight: 600;">→ Batch Release DDR</a></p>
      </div>
      <p style="font-size: 14px; line-height: 1.6; color: #3A3A3A;">Each DDR includes three parts: a completed reference case, an evidence checklist, and a blank template for your own decision. Access is valid until <strong>${formatExpiry(expiresAt)}</strong>.</p>
      <p style="font-size: 14px; line-height: 1.6; color: #3A3A3A;">Bookmark the links above. They are personal to you — please do not share them. If you need access for colleagues, reply to this email.</p>
      <p style="font-size: 14px; line-height: 1.6; margin-top: 28px;">— Jon Nugent<br/>ComplianceWorxs</p>
    </div>
  `;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [email],
        subject: 'Your Decision Defense Records — access links inside',
        html: html,
      }),
    });
  } catch (err) {
    console.error('Access email send failed:', err);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    // Read raw body once — needed for signature verification AND for JSON parsing.
    const rawBody = await req.text();
    const stripeSig = req.headers.get('stripe-signature') || '';

    // Route by request shape
    let body: any;
    try { body = JSON.parse(rawBody); } catch { return json({ error: 'Invalid JSON' }, 400); }

    const isStripeWebhook = body.type === 'checkout.session.completed' && body.data?.object;
    const isAdminGrant = body.mode === 'admin';

    if (!isStripeWebhook && !isAdminGrant) {
      return json({ error: 'Unrecognized request. Expected Stripe webhook or admin grant.' }, 400);
    }

    // --- AUTH ---
    if (isStripeWebhook) {
      if (!STRIPE_WEBHOOK_SECRET) {
        console.error('STRIPE_WEBHOOK_SECRET_DDR not configured');
        return json({ error: 'Server not configured for Stripe webhooks' }, 500);
      }
      const validSig = await verifyStripeSignature(rawBody, stripeSig, STRIPE_WEBHOOK_SECRET);
      if (!validSig) {
        console.warn('Stripe signature verification FAILED');
        return json({ error: 'Invalid Stripe signature' }, 401);
      }
    } else if (isAdminGrant) {
      const providedSecret = req.headers.get('x-admin-secret') || body.admin_secret;
      if (!ADMIN_SECRET || providedSecret !== ADMIN_SECRET) {
        return json({ error: 'Unauthorized' }, 401);
      }
    }

    let email: string;
    let fullName: string | null = null;
    let source: string;
    let stripeSessionId: string | null = null;
    let stripeCustomerId: string | null = null;
    let validityDays = DEFAULT_VALIDITY_DAYS;
    let notes: string | null = null;

    if (isStripeWebhook) {
      const session = body.data.object;
      email = (session.customer_details?.email || session.customer_email || '').toLowerCase().trim();
      fullName = session.customer_details?.name || null;
      stripeSessionId = session.id || null;
      stripeCustomerId = session.customer || null;
      source = 'stripe';

      if (!email) return json({ error: 'No email on Stripe session' }, 400);
      if (!stripeSessionId) return json({ error: 'No session id' }, 400);

      // --- PRODUCT FILTER ---
      const matches = await sessionContainsDdrBundle(stripeSessionId);
      if (!matches) {
        // Not our product. Return 200 so Stripe stops retrying, but do nothing.
        return json({ ok: true, ignored: true, reason: 'Session does not contain DDR bundle product' });
      }

      // --- IDEMPOTENCY ---
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { data: existing } = await supabase
        .from('ddr_access_tokens')
        .select('token, expires_at')
        .eq('stripe_session_id', stripeSessionId)
        .maybeSingle();
      if (existing) {
        return json({ ok: true, token: existing.token, expires_at: existing.expires_at, idempotent: true });
      }
    } else {
      email = (body.email || '').toString().toLowerCase().trim();
      fullName = body.full_name || null;
      source = (body.source || 'admin').toString();
      validityDays = Number.isFinite(body.validity_days) && body.validity_days > 0 ? body.validity_days : DEFAULT_VALIDITY_DAYS;
      notes = body.notes || null;

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: 'Valid email required' }, 400);
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const token = generateToken();
    const grantedAt = new Date();
    const expiresAt = new Date(grantedAt.getTime() + validityDays * 24 * 60 * 60 * 1000);

    const { data: inserted, error: insertError } = await supabase
      .from('ddr_access_tokens')
      .insert({
        token,
        email,
        full_name: fullName,
        source,
        stripe_session_id: stripeSessionId,
        stripe_customer_id: stripeCustomerId,
        granted_at: grantedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        notes,
      })
      .select('token, expires_at')
      .single();

    if (insertError) {
      console.error('Insert failed:', insertError);
      return json({ error: 'Failed to create access token', details: insertError.message }, 500);
    }

    const shouldSendEmail = isStripeWebhook || body.send_email !== false;
    if (shouldSendEmail) {
      await sendAccessEmail(email, fullName, inserted.token, inserted.expires_at, source);
    }

    return json({
      ok: true,
      token: inserted.token,
      expires_at: inserted.expires_at,
      email,
      email_sent: shouldSendEmail,
      links: {
        deviation: `${SITE_BASE}${DDR_LINKS.deviation}?t=${inserted.token}`,
        capa: `${SITE_BASE}${DDR_LINKS.capa}?t=${inserted.token}`,
        batch: `${SITE_BASE}${DDR_LINKS.batch}?t=${inserted.token}`,
      },
    });

  } catch (err) {
    console.error('ddr-grant-access error:', err);
    return json({ error: (err as Error).message }, 500);
  }
});
