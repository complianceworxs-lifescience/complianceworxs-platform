// DISABLED — Stripe Connect abandoned April 23, 2026.
// ComplianceWorxs Stripe account is not eligible for Connect.
// Partner payouts now handled via PayPal.
// If you ever migrate CW to a Connect-enabled account, this function
// can be restored from git history or rebuilt from scratch.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async () => {
  return new Response(
    JSON.stringify({
      error: 'This endpoint is disabled. Partner payouts are handled via PayPal, not Stripe Connect.',
      deprecated: true,
    }),
    { status: 410, headers: { 'Content-Type': 'application/json' } }
  );
});
