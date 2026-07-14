// attribute-partner v2 — May 7 2026
// Page-visit attribution endpoint called from the partner attribution shim.
// Does NOT write commission rows — commissions are recorded by checkout-session-handler
// at purchase time using the partners + orders + partner_commissions tables.
//
// Purpose: validate the partner_code exists, log the visit for analytics,
// return 200 cleanly so the front-end shim doesn't surface errors.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, apikey, authorization',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const email = (body.email || '').toString().trim().toLowerCase();
    const partnerCode = (body.partner_code || '').toString().trim().toLowerCase();

    if (!email || !partnerCode) {
      return new Response(JSON.stringify({ ok: true, recorded: false, reason: 'missing_fields' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Validate partner exists & is active — unknown codes are silently ignored
    const { data: partner } = await supabase
      .from('partners')
      .select('id, partner_code, status, full_name')
      .ilike('partner_code', partnerCode)
      .maybeSingle();

    if (!partner || partner.status !== 'active') {
      return new Response(JSON.stringify({ ok: true, recorded: false, reason: 'partner_not_found_or_inactive' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Visit attribution is now tracked via the orders.partner_code path at purchase time.
    // We acknowledge here without writing — commission attribution happens in checkout-session-handler.
    console.log(`[attribute-partner] visit acknowledged: ${email} \u00b7 partner=${partner.partner_code}`);

    return new Response(JSON.stringify({
      ok: true,
      recorded: true,
      partner_code: partner.partner_code,
      partner_name: partner.full_name,
      note: 'Visit acknowledged. Commission attribution occurs at Stripe checkout via order metadata.',
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('attribute-partner error:', err);
    return new Response(JSON.stringify({ ok: true, recorded: false, error: err.message }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
