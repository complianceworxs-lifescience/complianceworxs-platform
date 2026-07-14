// stripe-price-audit — ad-hoc helper. Pulls all active Payment Links from
// Stripe and resolves each link's price/product/amount. Lets us reconcile
// the page-displayed prices on cases.complianceworxs.com against what
// Stripe is actually charging.
//
// Usage: GET /functions/v1/stripe-price-audit
//   optional ?link_id=plink_xxx to inspect a specific link
//   optional ?starts_with=fZu  to filter links whose URL contains a fragment

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY') ?? Deno.env.get('STRIPE_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

async function stripeFetch(path: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET}`,
      'Stripe-Version': '2024-11-20.acacia',
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`stripe_${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!STRIPE_SECRET) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'no_stripe_secret',
      message: 'STRIPE_SECRET_KEY not in edge function env',
    }, null, 2), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const url = new URL(req.url);
  const filterFragment = url.searchParams.get('starts_with') || '';
  const singleLinkId = url.searchParams.get('link_id');

  try {
    const results: any[] = [];

    if (singleLinkId) {
      const link = await stripeFetch(`payment_links/${singleLinkId}?expand[]=line_items&expand[]=line_items.data.price&expand[]=line_items.data.price.product`);
      results.push(await summarize(link));
    } else {
      let hasMore = true;
      let startingAfter: string | null = null;
      while (hasMore && results.length < 200) {
        const qp = new URLSearchParams({ limit: '50', active: 'true' });
        if (startingAfter) qp.set('starting_after', startingAfter);
        const page = await stripeFetch(`payment_links?${qp.toString()}`);
        for (const link of page.data || []) {
          if (filterFragment && !link.url.includes(filterFragment)) continue;
          // Re-fetch with expansion to get prices
          const expanded = await stripeFetch(`payment_links/${link.id}?expand[]=line_items&expand[]=line_items.data.price&expand[]=line_items.data.price.product`);
          results.push(await summarize(expanded));
        }
        hasMore = page.has_more;
        if (page.data?.length) startingAfter = page.data[page.data.length - 1].id;
        else hasMore = false;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      count: results.length,
      links: results,
    }, null, 2), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'stripe_error',
      message: (e as Error).message,
    }, null, 2), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});

async function summarize(link: any) {
  const lineItems = (link.line_items?.data || []).map((li: any) => ({
    description: li.description,
    quantity: li.quantity,
    price_id: li.price?.id,
    unit_amount_cents: li.price?.unit_amount,
    unit_amount_dollars: li.price?.unit_amount != null ? (li.price.unit_amount / 100).toFixed(2) : null,
    currency: li.price?.currency,
    recurring: li.price?.recurring,
    product_id: li.price?.product?.id,
    product_name: li.price?.product?.name,
  }));
  const total = lineItems.reduce((sum: number, li: any) =>
    sum + (li.unit_amount_cents ?? 0) * (li.quantity ?? 1), 0);
  return {
    payment_link_id: link.id,
    url: link.url,
    active: link.active,
    line_items: lineItems,
    computed_total_dollars: (total / 100).toFixed(2),
  };
}
