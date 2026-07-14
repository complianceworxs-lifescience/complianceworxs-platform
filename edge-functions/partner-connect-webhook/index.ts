// DISABLED — Stripe Connect abandoned April 23, 2026.
// ComplianceWorxs Stripe account is not eligible for Connect.
// Partner payouts now handled via PayPal.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async () => {
  return new Response('Disabled — PayPal payouts in use.', { status: 410 });
});
