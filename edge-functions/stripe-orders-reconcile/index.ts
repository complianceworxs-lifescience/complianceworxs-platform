// stripe-orders-reconcile — Daily check for missing orders
//
// Compares Stripe payment intents (last 14 days) against Supabase orders table.
// Any payment intent that succeeded but has no matching order row fires a
// critical strategy signal with the exact backfill SQL pre-written.
//
// Catches Payment Link gap, signature failures, webhook downtime, anything that
// causes a real Stripe revenue event to not land in the orders table.
//
// Runs daily at 7 AM ET via pg_cron. Manual run: GET this URL.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Look for a Stripe key under any common name
const STRIPE_KEY_VARIANTS = ['STRIPE_SECRET_KEY', 'STRIPE_API_KEY', 'Stripe_API_Key', 'stripe_secret_key'];
let STRIPE_KEY = '';
for (const v of STRIPE_KEY_VARIANTS) {
  const val = Deno.env.get(v);
  if (val) { STRIPE_KEY = val; break; }
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (!STRIPE_KEY) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'no_stripe_key',
      checked: STRIPE_KEY_VARIANTS,
      hint: 'Add STRIPE_SECRET_KEY to Supabase Edge Function secrets',
    }, null, 2), { status: 500 });
  }

  // Pull recent successful payment intents from Stripe (last 14 days, max 100)
  const fourteenDaysAgoUnix = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
  let stripeIntents: any[] = [];
  try {
    const params = new URLSearchParams({
      limit: '100',
      'created[gte]': String(fourteenDaysAgoUnix),
    });
    const r = await fetch(`https://api.stripe.com/v1/payment_intents?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${STRIPE_KEY}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`stripe_${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    stripeIntents = (j.data || []).filter((pi: any) => pi.status === 'succeeded');
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'stripe_fetch_failed',
      detail: err instanceof Error ? err.message : String(err),
    }, null, 2), { status: 500 });
  }

  // For each succeeded intent, check if it's in orders
  const missing: any[] = [];
  for (const pi of stripeIntents) {
    const { data: order } = await supabase
      .from('orders')
      .select('id')
      .eq('stripe_payment_intent_id', pi.id)
      .maybeSingle();

    if (!order) {
      // Try to extract email from charges / latest_charge for the backfill SQL
      let email: string | null = pi.receipt_email ?? null;
      let customerName: string | null = null;
      
      // Pull charge for billing details if we don't have email yet
      if (!email && pi.latest_charge) {
        try {
          const cr = await fetch(`https://api.stripe.com/v1/charges/${pi.latest_charge}`, {
            headers: { 'Authorization': `Bearer ${STRIPE_KEY}` },
            signal: AbortSignal.timeout(8000),
          });
          if (cr.ok) {
            const charge = await cr.json();
            email = charge.billing_details?.email ?? charge.receipt_email ?? null;
            customerName = charge.billing_details?.name ?? null;
          }
        } catch {}
      }

      missing.push({
        payment_intent_id: pi.id,
        amount_dollars: pi.amount / 100,
        currency: pi.currency,
        created_at: new Date(pi.created * 1000).toISOString(),
        email,
        customer_name: customerName,
      });
    }
  }

  // If gaps found, fire a critical strategy signal
  if (missing.length > 0) {
    const totalMissing = missing.reduce((s, m) => s + m.amount_dollars, 0);
    const oldestMissing = missing.reduce((min, m) => m.created_at < min ? m.created_at : min, missing[0].created_at);

    // Build backfill SQL the user can paste
    const backfillSql = missing.map(m => {
      const safeEmail = (m.email || 'UNKNOWN_EMAIL').replace(/'/g, "''");
      const safeName = (m.customer_name || '').replace(/'/g, "''");
      return `-- Backfill ${m.payment_intent_id} ($${m.amount_dollars}, ${m.email || 'no email'})
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE stripe_payment_intent_id = '${m.payment_intent_id}') THEN
    INSERT INTO orders (
      contact_id, stripe_payment_intent_id, order_status, product_type,
      amount_cents, currency, purchased_at, metadata
    )
    SELECT
      (SELECT id FROM contacts WHERE email = '${safeEmail}' LIMIT 1),
      '${m.payment_intent_id}', 'completed', 'unknown',
      ${Math.round(m.amount_dollars * 100)}, '${m.currency}', '${m.created_at}'::timestamptz,
      jsonb_build_object(
        'source', 'auto_backfill_via_reconcile',
        'customer_email', '${safeEmail}',
        'customer_name', '${safeName}',
        'backfilled_at', now()::text,
        'spine_gap_note', 'Auto-detected by stripe-orders-reconcile, manually backfilled'
      );
  END IF;
END $$;`;
    }).join('\n\n');

    // Insert/update strategy signal
    await supabase.from('strategy_signals').upsert({
      signal_type: 'stripe_orders_gap',
      severity: 'critical',
      title: `${missing.length} Stripe payment(s) missing from orders table — $${totalMissing.toFixed(2)} unrecorded`,
      detail: `Found ${missing.length} succeeded Stripe payment intent(s) over the last 14 days that have no matching row in the Supabase orders table. Oldest gap: ${oldestMissing.slice(0,10)}. The Postgres trigger that fires PostHog purchase events depends on these orders existing, so missing rows = missing PostHog purchase events = revenue invisible to the optimization layer.`,
      suggested_action: `Backfill via the SQL block in the detail. Then investigate stripe-webhook function for why these specific intents weren''t processed (likely Payment Links vs. Checkout Sessions). Once backfilled, the Postgres trigger will fire PostHog purchase events automatically.`,
      // Stash the backfill SQL in detail field as JSON
    }, { onConflict: 'signal_type, title' });

    // Also store the full backfill SQL in a dedicated table so it doesn't get lost
    await supabase.from('strategy_signals').update({
      detail: `${missing.length} Stripe payment intent(s) succeeded but have no matching orders row. Total: $${totalMissing.toFixed(2)}. Missing IDs: ${missing.map(m => m.payment_intent_id).join(', ')}. Backfill SQL is below — paste into Supabase SQL editor.\n\n${backfillSql}`,
    })
    .eq('signal_type', 'stripe_orders_gap')
    .is('resolved_at', null);
  } else {
    // No gaps — auto-resolve any existing gap signal (the system caught up)
    await supabase.from('strategy_signals')
      .update({ resolved_at: new Date().toISOString(), resolution: 'Auto-resolved: all Stripe intents now have matching orders rows.' })
      .eq('signal_type', 'stripe_orders_gap')
      .is('resolved_at', null);
  }

  // Always log the run for audit
  await supabase.from('events').insert({
    session_id: 'system_reconcile',
    event_name: 'stripe_orders_reconcile_run',
    page: '/system',
    properties: {
      checked: stripeIntents.length,
      missing_count: missing.length,
      missing_ids: missing.map(m => m.payment_intent_id),
      total_missing_dollars: missing.reduce((s, m) => s + m.amount_dollars, 0),
    },
  });

  return new Response(JSON.stringify({
    ok: true,
    checked_payment_intents: stripeIntents.length,
    missing_from_orders: missing.length,
    total_missing_dollars: missing.reduce((s, m) => s + m.amount_dollars, 0),
    missing,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
