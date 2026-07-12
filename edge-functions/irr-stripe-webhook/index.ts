import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET_IRR') ?? '';
const ATTIO_API_KEY = Deno.env.get('ATTIO_API_KEY') ?? '';

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

  if (STRIPE_WEBHOOK_SECRET) {
    const valid = await verifyStripeSignature(body, signature, STRIPE_WEBHOOK_SECRET);
    if (!valid) return new Response('Unauthorized', { status: 401 });
  }

  const event = JSON.parse(body);
  if (event.type !== 'checkout.session.completed') return new Response('OK', { status: 200 });

  const session = event.data.object;
  const irrSessionId = session.metadata?.irr_session_id;
  if (!irrSessionId) return new Response('OK', { status: 200 });

  const customerEmail = session.customer_details?.email || session.customer_email || null;
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Mark session as paid
  await supabase
    .from('irr_sessions')
    .update({
      paid: true,
      stripe_session_id: session.id,
      stripe_payment_intent: session.payment_intent,
      email: customerEmail,
      membership_credit_expires_at: expiresAt,
    })
    .eq('id', irrSessionId);

  // Upsert Attio contact if email exists
  if (customerEmail && ATTIO_API_KEY) {
    try {
      await fetch('https://api.attio.com/v2/objects/people/records', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${ATTIO_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            values: {
              email_addresses: [{ email_address: customerEmail }],
              irr_purchased_at: new Date().toISOString(),
              membership_credit_expires_at: expiresAt,
              irr_session_id: irrSessionId,
            }
          },
          matching_attribute: 'email_addresses',
        }),
      });
    } catch (e) {
      console.error('Attio upsert failed:', e);
    }
  }

  console.log('IRR session unlocked:', irrSessionId, 'email:', customerEmail);
  return new Response('OK', { status: 200 });
});
