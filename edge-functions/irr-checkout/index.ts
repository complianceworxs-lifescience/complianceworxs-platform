import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const STRIPE_PRICE_ID_IRR_503B = Deno.env.get('STRIPE_PRICE_ID_IRR_503B') ?? '';

const PRODUCT_CATALOG: Record<string, { price_id: string; return_url_base: string; label: string }> = {
  'irr': {
    price_id: 'price_1TNFcPLKXrb8NHcrbqDFu6t9',
    return_url_base: 'https://www.complianceworxs.com/irr',
    label: 'Inspection Response Record',
  },
  'irr-503b': {
    price_id: STRIPE_PRICE_ID_IRR_503B,
    return_url_base: 'https://www.complianceworxs.com/503b/irr',
    label: '503B Inspection Response Record',
  },
  'irr-pharma': {
    price_id: 'price_1TcNABBcdOgm3yGB47CXbjyd',
    return_url_base: 'https://www.complianceworxs.com/pharma/irr',
    label: 'Pharma Inspection Response Record',
  },
  'irr-cosmetics': {
    price_id: 'price_1TcNpPBcdOgm3yGBxYPHKDIO',
    return_url_base: 'https://www.complianceworxs.com/cosmetics/irr',
    label: 'Cosmetics MoCRA Inspection Response Record',
  },
  'irr-food-beverage': {
    price_id: 'price_1TcNzhBcdOgm3yGB0jov1Nrx',
    return_url_base: 'https://www.complianceworxs.com/food-beverage/irr',
    label: 'Food Safety Inspection Response Record',
  },
  'batch-release-defense-pack': {
    price_id: 'price_1TM8O7BcdOgm3yGBioxrFeJe',
    return_url_base: 'https://defend.complianceworxs.com/batch-release/unlock',
    label: 'Batch Release Defense Pack',
  },
};

const DEFAULT_PRODUCT = 'irr';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer, accept, accept-profile, content-profile',
  'Access-Control-Max-Age': '86400',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  try {
    const { session_id, product_type, partner_code } = await req.json();
    if (!session_id) {
      return new Response(JSON.stringify({ error: 'session_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const productKey = product_type && PRODUCT_CATALOG[product_type] ? product_type : DEFAULT_PRODUCT;
    const product = PRODUCT_CATALOG[productKey];

    if (!product.price_id) {
      return new Response(JSON.stringify({
        error: `Stripe price not yet configured for product: ${productKey}. Set STRIPE_PRICE_ID_IRR_503B environment variable.`
      }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: session, error } = await supabase
      .from('irr_sessions')
      .select('id, paid, question')
      .eq('id', session_id)
      .single();

    if (error || !session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (session.paid) {
      return new Response(JSON.stringify({ error: 'Already paid', already_paid: true }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const successUrl = `${product.return_url_base}?session_id=${session_id}&payment=success&stripe_session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${product.return_url_base}?session_id=${session_id}`;

    const params = new URLSearchParams({
      'mode': 'payment',
      'line_items[0][price]': product.price_id,
      'line_items[0][quantity]': '1',
      'success_url': successUrl,
      'cancel_url': cancelUrl,
      'metadata[irr_session_id]': session_id,
      'metadata[product_type]': productKey,
      'customer_creation': 'always',
      'billing_address_collection': 'required',
      'allow_promotion_codes': 'true',
    });

    if (partner_code && typeof partner_code === 'string' && partner_code.trim()) {
      const code = partner_code.trim().toUpperCase().slice(0, 32);
      params.append('client_reference_id', code);
      params.append('metadata[partner_code]', code);
    }

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const stripeData = await stripeRes.json();
    if (stripeData.error) throw new Error(stripeData.error.message);

    return new Response(JSON.stringify({ checkout_url: stripeData.url, product_label: product.label }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});