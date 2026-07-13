import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// Case-file checkout. Creates a $149 Stripe Checkout Session and stamps the
// case_file_slug + product_type metadata that checkout-session-handler reads to
// trigger PDF fulfillment (purchase-fulfillment-send). Fulfillment is keyed off
// metadata, NOT the product/price, so a single clean $149 price is used for all.

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const PRICE_ID = 'price_1TcSCBBcdOgm3yGBOARhtj75'; // $149 — ComplianceWorxs Inspection Case File
const BASE = 'https://cases.complianceworxs.com';

// Allowlist: only the sellable case files the automation wires + fulfillment can deliver.
const CASE_FILES: Record<string, string> = {
  'capa-effectiveness': 'CAPA Effectiveness Determination',
  'batch-release-authorization': 'Batch Release Authorization',
  'deviation-root-cause': 'Deviation Root Cause Determination',
  'process-validation-conclusion': 'Process Validation Conclusion',
  'change-control-risk': 'Change Control Filing Determination',
  'oos-investigation': 'OOS Investigation Closure',
  'data-integrity': 'Data Integrity Investigation Closure',
  'supplier-qualification': 'Supplier Qualification Exception',
  'stability-oot': 'Stability Out-of-Trend Evaluation',
  'complaint-investigation': 'Complaint Investigation Disposition',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const slug = (body.slug ?? '').toString().trim().toLowerCase().replace(/^\/+|\/+$/g, '');
    const name = CASE_FILES[slug];
    if (!name) {
      return new Response(JSON.stringify({ error: 'Unknown case file: ' + slug }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sessionId = (body.session_id ?? '').toString().slice(0, 128);
    const utmSource = (body.utm_source ?? '').toString().slice(0, 128);
    const utmCampaign = (body.utm_campaign ?? '').toString().slice(0, 128);
    const utmContent = (body.utm_content ?? '').toString().slice(0, 128);

    const params = new URLSearchParams({
      'mode': 'payment',
      'line_items[0][price]': PRICE_ID,
      'line_items[0][quantity]': '1',
      'success_url': `${BASE}/${slug}?purchase=success&cs={CHECKOUT_SESSION_ID}`,
      'cancel_url': `${BASE}/${slug}`,
      'customer_creation': 'always',
      'billing_address_collection': 'required',
      'allow_promotion_codes': 'true',
      'metadata[case_file_slug]': slug,
      'metadata[case_file_id]': slug,
      'metadata[case_file_name]': name,
      'metadata[product_type]': 'case_file',
      'metadata[cw_session_id]': sessionId,
      'metadata[utm_source]': utmSource,
      'metadata[utm_campaign]': utmCampaign,
      'metadata[utm_content]': utmContent,
    });

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    return new Response(JSON.stringify({ url: data.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
