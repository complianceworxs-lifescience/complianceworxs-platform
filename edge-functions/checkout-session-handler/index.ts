import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14';

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const STRIPE_SECRET  = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('STRIPE_CHECKOUT_WEBHOOK_SECRET') ?? '';
const ATTIO_KEY      = Deno.env.get('ATTIO_API_KEY') ?? '';
const ATTIO_API      = 'https://api.attio.com/v2';

// Trigger PDF fulfillment after a successful purchase
async function triggerFulfillment(opts: {
  email: string;
  productSlug: string | null;
  productSku: string;
  customerName: string | null;
  orderId: string | null;
}) {
  if (!opts.productSlug && !opts.productSku) return { triggered: false, reason: 'no_product_identifier' };
  // Only fulfill case files for now (bundle and other product types handled separately)
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/purchase-fulfillment-send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({
        email: opts.email,
        product_slug: opts.productSlug,
        product_sku: opts.productSku,
        customer_name: opts.customerName,
        order_id: opts.orderId,
      }),
    });
    const j = await r.json();
    return { triggered: true, ok: r.ok, status: r.status, response: j };
  } catch (e) {
    return { triggered: true, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const PRODUCT_MAP: Record<number, { sku: string; type: string; slug: string; name: string }> = {
  14900: { sku: 'CF-CASE-FILE', type: 'case_file',                slug: 'case-file',               name: 'Case File ($149)' },
   2700: { sku: 'DAM-27',       type: 'decision_authority_matrix', slug: 'decision-authority-matrix', name: 'Decision Authority Matrix ($27)' },
  29700: { sku: 'CF-BUNDLE',    type: 'bundle',                   slug: 'authorization-package',   name: 'Authorization Bundle ($297)' },
};

async function attioRequest(path: string, method = 'GET', body?: unknown) {
  if (!ATTIO_KEY) return null;
  const res = await fetch(`${ATTIO_API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ATTIO_KEY}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { console.error(`Attio ${method} ${path} -> ${res.status}: ${await res.text()}`); return null; }
  return res.json();
}

async function attioFlipToBuyer(email: string, productName: string): Promise<string | null> {
  const result = await attioRequest('/objects/people/records', 'PUT', {
    data: {
      values: {
        email_addresses: [{ email_address: email }],
        lifecycle_stage: 'Buyer',
        outreach_status: 'Qualified',
        next_action:     'Buyer \u2014 consider upsell or enterprise conversation.',
      },
    },
  });
  const recordId = result?.data?.id?.record_id ?? null;
  if (recordId) {
    await attioRequest('/notes', 'POST', {
      data: {
        parent_object:     'people',
        parent_record_id:  recordId,
        title:             `Purchase: ${productName}`,
        format:            'plaintext',
        content_plaintext: `Purchase confirmed via Stripe.\n\nProduct: ${productName}\nEmail: ${email}\nTimestamp: ${new Date().toISOString()}\n\nLifecycle Stage automatically advanced to Buyer.`,
      },
    });
    console.log(`Attio: ${email} -> Buyer [${productName}]`);
  }
  return recordId;
}

async function attributePartnerCommission(opts: {
  partnerCodeRaw: string | null;
  email: string;
  contactId: string;
  amountCents: number;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
  productSku: string;
}) {
  if (!opts.partnerCodeRaw) return { attributed: false, reason: 'no_code' };
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
  const code = opts.partnerCodeRaw.trim().toUpperCase();
  if (!code || code.length < 2 || code.length > 32) return { attributed: false, reason: 'invalid_code_format' };

  const { data: partner } = await supabase
    .from('partners')
    .select('id, partner_code, status, commission_rate')
    .ilike('partner_code', code)
    .maybeSingle();

  if (!partner) { console.warn(`partner_code ${code} not found in partners table`); return { attributed: false, reason: 'partner_not_found' }; }
  if (partner.status !== 'active') { console.warn(`partner ${code} status=${partner.status}, skipping commission`); return { attributed: false, reason: 'partner_not_active' }; }

  let orderId: string | null = null;
  if (opts.stripePaymentIntentId) {
    const { data: o } = await supabase.from('orders').select('id').eq('stripe_payment_intent_id', opts.stripePaymentIntentId).maybeSingle();
    if (o) orderId = o.id;
  } else if (opts.stripeCheckoutSessionId) {
    const { data: o } = await supabase.from('orders').select('id').eq('stripe_checkout_session_id', opts.stripeCheckoutSessionId).maybeSingle();
    if (o) orderId = o.id;
  }

  if (orderId) {
    await supabase.from('orders').update({
      partner_code: partner.partner_code,
      partner_id: partner.id,
    }).eq('id', orderId);
  }

  const rate = parseFloat(partner.commission_rate as unknown as string) || 0.25;
  const commissionCents = Math.round(opts.amountCents * rate);

  if (orderId) {
    const { data: existingCommission } = await supabase
      .from('partner_commissions')
      .select('id')
      .eq('order_id', orderId)
      .maybeSingle();
    if (existingCommission) return { attributed: true, duplicate: true, partner_id: partner.id, partner_code: partner.partner_code };
  }

  await supabase.from('partner_commissions').insert({
    partner_id: partner.id,
    partner_code: partner.partner_code,
    order_id: orderId,
    contact_id: opts.contactId,
    stripe_payment_intent_id: opts.stripePaymentIntentId,
    amount_cents: opts.amountCents,
    commission_cents: commissionCents,
    commission_rate: rate,
    payout_status: 'pending',
    notes: `Auto-attributed via ${opts.stripePaymentIntentId ? 'payment_intent' : 'checkout_session'} \u00b7 sku=${opts.productSku}`,
  });

  console.log(`Commission attributed: ${partner.partner_code} \u2014 $${commissionCents / 100} on $${opts.amountCents / 100} purchase`);
  return { attributed: true, partner_code: partner.partner_code, commission_cents: commissionCents };
}

async function processPurchase(opts: {
  email: string;
  amountCents: number;
  currency: string;
  stripeCustomerId: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  customerName: string | null;
  paymentStatus: string;
  source: 'checkout_session' | 'payment_intent';
  partnerCode: string | null;
  // NEW: case file metadata read from Stripe payment link metadata
  caseFileSlug: string | null;
  caseFileId: string | null;
  caseFileName: string | null;
  productType: string | null;
}) {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
  const now = new Date().toISOString();

  // If we have explicit case file metadata, prefer that over price-based fallback
  const product = opts.caseFileSlug ? {
    sku: opts.caseFileId ?? 'CF-CASE-FILE',
    type: opts.productType ?? 'case_file',
    slug: opts.caseFileSlug,
    name: opts.caseFileName ?? `Case File: ${opts.caseFileSlug}`,
  } : (PRODUCT_MAP[opts.amountCents] ?? { sku: 'CF-UNKNOWN', type: 'case_file', slug: 'unknown', name: `Unknown product ($${opts.amountCents / 100})` });

  // De-dupe
  if (opts.stripePaymentIntentId || opts.stripeCheckoutSessionId) {
    let q = supabase.from('orders').select('id').limit(1);
    if (opts.stripePaymentIntentId) q = q.eq('stripe_payment_intent_id', opts.stripePaymentIntentId);
    else if (opts.stripeCheckoutSessionId) q = q.eq('stripe_checkout_session_id', opts.stripeCheckoutSessionId);
    const { data: existing } = await q;
    if (existing && existing.length > 0) {
      console.log(`Order already exists \u2014 skipping`);
      return { skipped: true, reason: 'duplicate' };
    }
  }

  // 1. Upsert contact
  const { data: contact, error: contactErr } = await supabase
    .from('contacts')
    .upsert({
      email: opts.email,
      normalized_email: opts.email,
      full_name: opts.customerName,
      first_name: opts.customerName ? opts.customerName.split(' ')[0] : null,
      last_name: opts.customerName ? opts.customerName.split(' ').slice(1).join(' ') || null : null,
      lifecycle_stage: 'buyer',
      consent_status: 'implied',
      consent_source: 'stripe_purchase',
      stripe_customer_id: opts.stripeCustomerId,
      updated_at: now,
    }, { onConflict: 'normalized_email', ignoreDuplicates: false })
    .select('id').single();

  if (contactErr || !contact?.id) {
    console.error('contact upsert error:', contactErr);
    throw new Error('contact_upsert_failed');
  }
  const contactId = contact.id;

  // 2. Entitlement
  await supabase.from('entitlements').upsert({
    email: opts.email, product_id: product.sku, purchase_ts: now, status: 'active',
    session_id: opts.stripeCheckoutSessionId || opts.stripePaymentIntentId,
  }, { onConflict: 'email,product_id', ignoreDuplicates: true });

  // 3. Orders
  const { data: orderRow } = await supabase.from('orders').insert({
    contact_id: contactId,
    stripe_checkout_session_id: opts.stripeCheckoutSessionId,
    stripe_payment_intent_id: opts.stripePaymentIntentId,
    stripe_customer_id: opts.stripeCustomerId,
    order_status: opts.paymentStatus === 'paid' || opts.paymentStatus === 'succeeded' ? 'completed' : 'pending',
    product_type: product.type,
    product_sku: product.sku,
    product_slug: product.slug,
    amount_cents: opts.amountCents,
    currency: opts.currency,
    purchased_at: now,
    partner_code: opts.partnerCode ? opts.partnerCode.trim().toUpperCase() : null,
    metadata: {
      session_id: opts.stripeCheckoutSessionId,
      payment_intent: opts.stripePaymentIntentId,
      customer_email: opts.email,
      customer_name: opts.customerName,
      payment_status: opts.paymentStatus,
      amount_total: opts.amountCents,
      source: opts.source,
      partner_code: opts.partnerCode,
      case_file_slug: opts.caseFileSlug,
      case_file_id: opts.caseFileId,
      case_file_name: opts.caseFileName,
    },
  }).select('id').single();

  const orderId = orderRow?.id ?? null;

  // 4. Backward compat purchases
  await supabase.from('purchases').upsert({
    email: opts.email, case_file: product.sku, case_file_id: product.sku,
    stripe_session_id: opts.stripeCheckoutSessionId || opts.stripePaymentIntentId,
    purchased_at: now,
  }, { onConflict: 'stripe_session_id', ignoreDuplicates: true });

  // 5. Mark lead as buyer
  await supabase.from('leads').update({
    is_buyer: true, converted_at: now,
    stripe_session_id: opts.stripeCheckoutSessionId || opts.stripePaymentIntentId,
  }).eq('email', opts.email);

  // 6. lead_intents
  await supabase.from('lead_intents').upsert({
    contact_id: contactId,
    assessment_started: false, assessment_completed: false, lock_viewed: true, cta_clicked: true,
    return_visits: 0, high_intent: true, last_activity_at: now, created_at: now, updated_at: now,
  }, { onConflict: 'contact_id' });

  // 7. Attio Buyer flip
  await attioFlipToBuyer(opts.email, product.name);

  // 8. Partner commission attribution
  let commissionResult: any = { attributed: false };
  if (opts.partnerCode) {
    commissionResult = await attributePartnerCommission({
      partnerCodeRaw: opts.partnerCode,
      email: opts.email,
      contactId,
      amountCents: opts.amountCents,
      stripePaymentIntentId: opts.stripePaymentIntentId,
      stripeCheckoutSessionId: opts.stripeCheckoutSessionId,
      productSku: product.sku,
    });
  }

  // 9. NEW: Trigger PDF fulfillment via Resend (case files only, not bundle)
  let fulfillmentResult: any = { triggered: false };
  if (product.type === 'case_file' && opts.caseFileSlug) {
    fulfillmentResult = await triggerFulfillment({
      email: opts.email,
      productSlug: opts.caseFileSlug,
      productSku: product.sku,
      customerName: opts.customerName,
      orderId,
    });
    console.log(`Fulfillment triggered for ${opts.email} \u2014 ${product.slug}: ${JSON.stringify(fulfillmentResult)}`);
  } else if (product.type === 'bundle') {
    console.log(`Bundle purchase \u2014 fulfillment not yet implemented for bundle delivery`);
  } else {
    console.log(`Skipping fulfillment for product type: ${product.type}, slug: ${opts.caseFileSlug ?? '(none)'}`);
  }

  console.log(`Purchase processed [${opts.source}]: ${opts.email} \u2014 ${product.sku} \u2014 $${opts.amountCents / 100}${opts.partnerCode ? ` \u2014 partner=${opts.partnerCode}` : ''}`);
  return { skipped: false, contactId, orderId, sku: product.sku, slug: product.slug, commission: commissionResult, fulfillment: fulfillmentResult };
}

function extractPartnerCode(stripeObject: any): string | null {
  if (!stripeObject) return null;
  if (typeof stripeObject.client_reference_id === 'string' && stripeObject.client_reference_id.trim()) {
    return stripeObject.client_reference_id.trim();
  }
  if (stripeObject.metadata && typeof stripeObject.metadata.partner_code === 'string' && stripeObject.metadata.partner_code.trim()) {
    return stripeObject.metadata.partner_code.trim();
  }
  if (stripeObject.metadata && typeof stripeObject.metadata.ref === 'string' && stripeObject.metadata.ref.trim()) {
    return stripeObject.metadata.ref.trim();
  }
  if (stripeObject.metadata && typeof stripeObject.metadata.cw_ref === 'string' && stripeObject.metadata.cw_ref.trim()) {
    return stripeObject.metadata.cw_ref.trim();
  }
  return null;
}

function extractCaseFileMetadata(stripeObject: any): { slug: string | null; id: string | null; name: string | null; productType: string | null } {
  const m = stripeObject?.metadata ?? {};
  return {
    slug: typeof m.case_file_slug === 'string' && m.case_file_slug.trim() ? m.case_file_slug.trim() : null,
    id:   typeof m.case_file_id === 'string' && m.case_file_id.trim() ? m.case_file_id.trim() : null,
    name: typeof m.case_file_name === 'string' && m.case_file_name.trim() ? m.case_file_name.trim() : null,
    productType: typeof m.product_type === 'string' && m.product_type.trim() ? m.product_type.trim() : null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, stripe-signature' },
    });
  }
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  const body = await req.text();
  const signature = req.headers.get('stripe-signature') ?? '';
  let event: Stripe.Event;
  const stripe = new Stripe(STRIPE_SECRET, { apiVersion: '2024-06-20' });

  if (WEBHOOK_SECRET) {
    try { event = stripe.webhooks.constructEvent(body, signature, WEBHOOK_SECRET); }
    catch (err) {
      console.error('Webhook signature verification failed:', err);
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 400 });
    }
  } else {
    try { event = JSON.parse(body) as Stripe.Event; }
    catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const email = session.customer_details?.email?.trim().toLowerCase() ?? null;
      if (!email) {
        console.error('checkout.session.completed \u2014 no customer email', session.id);
        return new Response(JSON.stringify({ received: true, error: 'no_email' }), { status: 200 });
      }
      const cfMeta = extractCaseFileMetadata(session);
      const result = await processPurchase({
        email,
        amountCents: session.amount_total ?? 0,
        currency: session.currency ?? 'usd',
        stripeCustomerId: typeof session.customer === 'string' ? session.customer : (session.customer as any)?.id ?? null,
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        customerName: session.customer_details?.name ?? null,
        paymentStatus: session.payment_status ?? 'unknown',
        source: 'checkout_session',
        partnerCode: extractPartnerCode(session),
        caseFileSlug: cfMeta.slug,
        caseFileId: cfMeta.id,
        caseFileName: cfMeta.name,
        productType: cfMeta.productType,
      });
      return new Response(JSON.stringify({ received: true, ...result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent;
      try {
        const sessions = await stripe.checkout.sessions.list({ payment_intent: pi.id, limit: 1 });
        if (sessions.data.length > 0) {
          console.log(`PI ${pi.id} is linked to checkout session \u2014 skipping (Path A handles it)`);
          return new Response(JSON.stringify({ received: true, skipped: 'has_checkout_session' }), { status: 200 });
        }
      } catch (e) {
        console.warn('Could not check for linked checkout sessions:', e);
      }

      let email: string | null = null;
      let customerName: string | null = null;
      let chargeMetadata: any = null;
      if (pi.latest_charge) {
        try {
          const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge.id;
          const charge = await stripe.charges.retrieve(chargeId);
          email = charge.billing_details?.email?.trim().toLowerCase() ?? charge.receipt_email?.trim().toLowerCase() ?? null;
          customerName = charge.billing_details?.name ?? null;
          chargeMetadata = charge.metadata;
        } catch (e) {
          console.error('Failed to retrieve charge:', e);
        }
      }
      if (!email && pi.receipt_email) email = pi.receipt_email.trim().toLowerCase();
      if (!email) {
        console.error('payment_intent.succeeded \u2014 no email available', pi.id);
        return new Response(JSON.stringify({ received: true, error: 'no_email', pi: pi.id }), { status: 200 });
      }

      let partnerCode = extractPartnerCode(pi);
      if (!partnerCode && chargeMetadata) {
        partnerCode = extractPartnerCode({ metadata: chargeMetadata });
      }

      // Try to extract case file metadata from PI metadata or charge metadata
      let cfMeta = extractCaseFileMetadata(pi);
      if (!cfMeta.slug && chargeMetadata) {
        cfMeta = extractCaseFileMetadata({ metadata: chargeMetadata });
      }

      const result = await processPurchase({
        email,
        amountCents: pi.amount,
        currency: pi.currency,
        stripeCustomerId: typeof pi.customer === 'string' ? pi.customer : null,
        stripeCheckoutSessionId: null,
        stripePaymentIntentId: pi.id,
        customerName,
        paymentStatus: 'succeeded',
        source: 'payment_intent',
        partnerCode,
        caseFileSlug: cfMeta.slug,
        caseFileId: cfMeta.id,
        caseFileName: cfMeta.name,
        productType: cfMeta.productType,
      });
      return new Response(JSON.stringify({ received: true, ...result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ received: true, skipped: event.type }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('checkout-session-handler error:', err);
    return new Response(JSON.stringify({ error: 'internal_error', message: (err as Error).message }), { status: 500 });
  }
});
