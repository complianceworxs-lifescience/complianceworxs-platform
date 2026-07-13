import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET_DEFENSE_PACK') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const TOKEN_GRANT_MAP: Record<string, { tokens: number; scenario: string }> = {
  'price_1TM8O7BcdOgm3yGBioxrFeJe': { tokens: 1, scenario: 'batch-release' },
};

async function verifyStripeSignature(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const parts = signature.split(',');
    const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1];
    const v1 = parts.find(p => p.startsWith('v1='))?.split('=')[1];
    if (!timestamp || !v1) return false;
    const signedPayload = `${timestamp}.${body}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
    const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    return computed === v1;
  } catch { return false; }
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.text();
  const signature = req.headers.get('stripe-signature') ?? '';
  const valid = await verifyStripeSignature(body, signature, STRIPE_WEBHOOK_SECRET);
  if (!valid) return new Response('Unauthorized', { status: 401 });

  const event = JSON.parse(body);
  if (event.type !== 'checkout.session.completed') return new Response('OK', { status: 200 });

  const session = event.data.object;
  const customerEmail = session.customer_details?.email || session.customer_email;
  const priceId = session.metadata?.price_id || '';
  if (!customerEmail) return new Response('OK', { status: 200 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: existing } = await supabase.from('stripe_token_purchases').select('id').eq('stripe_event_id', event.id).single();
  if (existing) return new Response('OK', { status: 200 });

  const grant = TOKEN_GRANT_MAP[priceId] || { tokens: 1, scenario: 'batch-release' };

  await supabase.from('stripe_token_purchases').insert({
    stripe_event_id: event.id,
    stripe_session_id: session.id,
    customer_email: customerEmail,
    price_id: priceId,
    tokens_granted: grant.tokens,
    scenario: grant.scenario,
  });

  const { data: existingUser } = await supabase.auth.admin.getUserByEmail(customerEmail);
  let userId = existingUser?.user?.id;

  if (!userId) {
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({ email: customerEmail, email_confirm: true });
    if (createError) return new Response('Error', { status: 500 });
    userId = newUser.user.id;
  }

  const { data: existingTokens } = await supabase.from('user_tokens').select('tokens_remaining, tokens_used').eq('user_id', userId).single();

  if (existingTokens) {
    await supabase.from('user_tokens').update({ tokens_remaining: existingTokens.tokens_remaining + grant.tokens }).eq('user_id', userId);
  } else {
    await supabase.from('user_tokens').insert({ user_id: userId, email: customerEmail, tokens_remaining: grant.tokens, tokens_used: 0, subscription_tier: 'pay_per_use' });
  }

  // Updated redirect → defend.complianceworxs.com
  await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: customerEmail,
    options: { redirectTo: 'https://defend.complianceworxs.com/batch-release/build' },
  });

  console.log('Token granted to:', customerEmail, 'tokens:', grant.tokens);
  return new Response('OK', { status: 200 });
});
