// page-price-audit v1 — May 19 2026
//
// Daily check that every public page in page_stripe_link_registry:
//   1. Renders the expected Stripe payment-link URL fragment
//   2. Renders the expected display price string (e.g. "$875")
//   3. Links to a Stripe payment link that is still active AND charging
//      the expected amount
//
// Built because the bundle page on cases.complianceworxs.com displayed
// '$297 All 10' for weeks while the linked Stripe payment link actually
// charged $297 for a 3-DDR bundle — not the all-10 product. Every visitor
// who clicked through would have been charged for the wrong product.
// The session briefing didn't catch it because the briefing knows nothing
// about page content vs. payment link content.
//
// Architecture: each registry row is one check. Mismatches become
// system_alerts rows with source='page-price-audit', auto-resolved when
// fixed. Session briefing already surfaces system_alerts in next chat.
//
// Cron: daily at 5:05 AM ET (5 min after the outbound audit, to stagger load)
// Manual: GET /functions/v1/page-price-audit?dry_run=1&verbose=1
//
// Usage notes:
//   - To add a new page/link/price to monitor: INSERT into page_stripe_link_registry
//   - To temporarily silence a check: UPDATE ... SET is_active = false
//   - If you change a price in Stripe, also UPDATE expected_amount_cents
//     here. If the two diverge, the audit will alert you.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY') ?? Deno.env.get('STRIPE_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

type Severity = 'critical' | 'warning' | 'info';
type Finding = { alert_type: string; severity: Severity; message: string; context: Record<string, any> };

async function stripeFetch(path: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET}`,
      'Stripe-Version': '2024-11-20.acacia',
    },
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`stripe_${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

async function fetchPageHtml(url: string): Promise<string> {
  // Some pages are static, some Astro-rendered. All return HTML server-side
  // (Astro SSG), so a plain GET is sufficient. No JS execution needed for
  // the price/link strings, which are statically rendered.
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'CW-PagePriceAudit/1.0 (+https://complianceworxs.com)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(20000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return await res.text();
}

async function persistFindings(supabase: any, findings: Finding[], dryRun: boolean): Promise<{
  inserted: number; refreshed: number; resolved: number;
}> {
  if (dryRun) return { inserted: 0, refreshed: 0, resolved: 0 };

  const findingTypes = new Set(findings.map(f => f.alert_type));
  const auditOwnedPrefixes = ['page_price_', 'page_link_', 'stripe_link_', 'page_fetch_', 'audit_check_'];

  const { data: openAlerts } = await supabase
    .from('system_alerts')
    .select('id, alert_type')
    .is('resolved_at', null)
    .eq('source', 'page-price-audit');

  let resolved = 0;
  for (const alert of openAlerts || []) {
    const ownedByAudit = auditOwnedPrefixes.some(p => alert.alert_type.startsWith(p));
    if (!ownedByAudit) continue;
    if (findingTypes.has(alert.alert_type)) continue;
    await supabase
      .from('system_alerts')
      .update({ resolved_at: new Date().toISOString(), acknowledged_by: 'page-price-audit_auto_resolved' })
      .eq('id', alert.id);
    resolved++;
  }

  let inserted = 0;
  let refreshed = 0;
  for (const f of findings) {
    const { data: existing } = await supabase
      .from('system_alerts')
      .select('id')
      .eq('alert_type', f.alert_type)
      .eq('source', 'page-price-audit')
      .is('resolved_at', null)
      .limit(1)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('system_alerts')
        .update({ message: f.message, context: f.context, severity: f.severity })
        .eq('id', existing.id);
      refreshed++;
    } else {
      await supabase
        .from('system_alerts')
        .insert({
          alert_type: f.alert_type,
          severity: f.severity,
          source: 'page-price-audit',
          message: f.message,
          context: f.context,
        });
      inserted++;
    }
  }
  return { inserted, refreshed, resolved };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === '1';
  const verbose = url.searchParams.get('verbose') === '1';

  if (!STRIPE_SECRET) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'no_stripe_secret',
      message: 'STRIPE_SECRET_KEY not configured in edge function environment',
    }, null, 2), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const startedAt = Date.now();

  // Load registry
  const { data: registry, error: regErr } = await supabase
    .from('page_stripe_link_registry')
    .select('id, page_url, page_label, stripe_payment_link_id, stripe_link_url_fragment, expected_display_price, expected_amount_cents, product_name')
    .eq('is_active', true);

  if (regErr) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'registry_read_failed',
      message: regErr.message,
    }, null, 2), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (!registry || registry.length === 0) {
    return new Response(JSON.stringify({
      ok: true,
      summary: 'No active rows in page_stripe_link_registry. Nothing to audit.',
      findings_count: 0,
    }, null, 2), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Cache Stripe payment-link lookups so multiple registry rows for the same
  // plink_id don't multiply Stripe API calls.
  const stripeCache = new Map<string, any>();

  async function getStripeLink(plinkId: string) {
    if (stripeCache.has(plinkId)) return stripeCache.get(plinkId);
    const data = await stripeFetch(
      `payment_links/${plinkId}?expand[]=line_items&expand[]=line_items.data.price&expand[]=line_items.data.price.product`
    );
    stripeCache.set(plinkId, data);
    return data;
  }

  const allFindings: Finding[] = [];
  const perRow: Array<{ id: number; label: string; status: string; issues: string[]; ms: number }> = [];

  // Also fetch each unique page only once (multiple registry rows may target same page)
  const pageCache = new Map<string, { html?: string; error?: string }>();

  async function getPageHtml(pageUrl: string) {
    if (pageCache.has(pageUrl)) return pageCache.get(pageUrl)!;
    try {
      const html = await fetchPageHtml(pageUrl);
      const cached = { html };
      pageCache.set(pageUrl, cached);
      return cached;
    } catch (e) {
      const cached = { error: (e as Error).message };
      pageCache.set(pageUrl, cached);
      return cached;
    }
  }

  for (const row of registry) {
    const rowStart = Date.now();
    const issues: string[] = [];
    let status = 'ok';

    // 1. Fetch the page
    const pageResult = await getPageHtml(row.page_url);
    if (pageResult.error) {
      const alertType = `page_fetch_failed_${row.id}`;
      allFindings.push({
        alert_type: alertType,
        severity: 'warning',
        message: `Cannot fetch ${row.page_label} (${row.page_url}): ${pageResult.error}`,
        context: { registry_id: row.id, page_url: row.page_url, error: pageResult.error },
      });
      issues.push(`fetch_failed: ${pageResult.error}`);
      status = 'page_unreachable';
      perRow.push({ id: row.id, label: row.page_label, status, issues, ms: Date.now() - rowStart });
      continue;
    }

    const html = pageResult.html!;

    // 2. Page must contain the Stripe link URL fragment
    if (!html.includes(row.stripe_link_url_fragment)) {
      const alertType = `page_link_missing_${row.id}`;
      allFindings.push({
        alert_type: alertType,
        severity: 'critical',
        message: `${row.page_label}: page does not contain expected Stripe link fragment "${row.stripe_link_url_fragment}". The bundle CTA is broken or points to a different product.`,
        context: {
          registry_id: row.id,
          page_url: row.page_url,
          expected_link_fragment: row.stripe_link_url_fragment,
        },
      });
      issues.push('link_missing_from_page');
      status = 'mismatch';
    }

    // 3. Page must contain the expected display price string
    if (!html.includes(row.expected_display_price)) {
      const alertType = `page_price_string_missing_${row.id}`;
      allFindings.push({
        alert_type: alertType,
        severity: 'critical',
        message: `${row.page_label}: page does not contain expected price string "${row.expected_display_price}". Displayed price likely diverged from Stripe.`,
        context: {
          registry_id: row.id,
          page_url: row.page_url,
          expected_price: row.expected_display_price,
        },
      });
      issues.push('price_string_missing_from_page');
      status = 'mismatch';
    }

    // 4. Stripe link must still charge the expected amount
    try {
      const link = await getStripeLink(row.stripe_payment_link_id);

      if (!link.active) {
        const alertType = `stripe_link_inactive_${row.id}`;
        allFindings.push({
          alert_type: alertType,
          severity: 'critical',
          message: `${row.page_label}: linked Stripe payment link ${row.stripe_payment_link_id} is INACTIVE. Customers clicking through will hit a dead checkout.`,
          context: {
            registry_id: row.id,
            page_url: row.page_url,
            stripe_payment_link_id: row.stripe_payment_link_id,
          },
        });
        issues.push('stripe_link_inactive');
        status = 'mismatch';
      }

      const lineItems = link.line_items?.data || [];
      const stripeTotal = lineItems.reduce(
        (sum: number, li: any) => sum + (li.price?.unit_amount ?? 0) * (li.quantity ?? 1),
        0
      );

      if (stripeTotal !== row.expected_amount_cents) {
        const alertType = `stripe_link_amount_mismatch_${row.id}`;
        allFindings.push({
          alert_type: alertType,
          severity: 'critical',
          message: `${row.page_label}: page expects $${(row.expected_amount_cents / 100).toFixed(2)} but Stripe payment link charges $${(stripeTotal / 100).toFixed(2)}. Customers will be charged the Stripe price, not the page price.`,
          context: {
            registry_id: row.id,
            page_url: row.page_url,
            stripe_payment_link_id: row.stripe_payment_link_id,
            expected_cents: row.expected_amount_cents,
            stripe_charges_cents: stripeTotal,
            stripe_product_name: lineItems[0]?.price?.product?.name,
          },
        });
        issues.push(`stripe_amount_mismatch: page=$${(row.expected_amount_cents / 100).toFixed(2)} stripe=$${(stripeTotal / 100).toFixed(2)}`);
        status = 'mismatch';
      }

      // Optional sanity check: product name on Stripe matches what's expected
      if (row.product_name && lineItems[0]?.price?.product?.name) {
        const stripeProductName = lineItems[0].price.product.name;
        if (stripeProductName !== row.product_name) {
          const alertType = `stripe_product_name_drift_${row.id}`;
          allFindings.push({
            alert_type: alertType,
            severity: 'warning',
            message: `${row.page_label}: expected product name "${row.product_name}" but Stripe says "${stripeProductName}". Customers see one name on the page, another at checkout.`,
            context: {
              registry_id: row.id,
              expected_product_name: row.product_name,
              stripe_product_name: stripeProductName,
            },
          });
          issues.push('product_name_drift');
          if (status === 'ok') status = 'drift';
        }
      }
    } catch (e) {
      allFindings.push({
        alert_type: `audit_check_failed_stripe_${row.id}`,
        severity: 'warning',
        message: `${row.page_label}: could not verify Stripe link ${row.stripe_payment_link_id}: ${(e as Error).message}`,
        context: { registry_id: row.id, error: (e as Error).message },
      });
      issues.push(`stripe_fetch_failed: ${(e as Error).message}`);
    }

    // Update last_verified_at
    if (!dryRun) {
      await supabase
        .from('page_stripe_link_registry')
        .update({
          last_verified_at: new Date().toISOString(),
          last_verification_result: status,
        })
        .eq('id', row.id);
    }

    perRow.push({ id: row.id, label: row.page_label, status, issues, ms: Date.now() - rowStart });
  }

  const persist = await persistFindings(supabase, allFindings, dryRun);

  const critical = allFindings.filter(f => f.severity === 'critical').length;
  const warning = allFindings.filter(f => f.severity === 'warning').length;
  const okCount = perRow.filter(r => r.status === 'ok').length;
  const mismatchCount = perRow.filter(r => r.status === 'mismatch').length;

  const summary = [
    `=== PAGE PRICE AUDIT ${new Date().toISOString()} ===`,
    ``,
    `Registry rows audited: ${perRow.length}`,
    `  Clean: ${okCount}`,
    `  Mismatch: ${mismatchCount}`,
    `  Page unreachable: ${perRow.filter(r => r.status === 'page_unreachable').length}`,
    ``,
    `Findings: ${allFindings.length} (${critical} critical, ${warning} warning)`,
    `Alerts written: ${persist.inserted} new | ${persist.refreshed} refreshed | ${persist.resolved} auto-resolved`,
    `Runtime: ${Date.now() - startedAt}ms`,
    `Mode: ${dryRun ? 'DRY RUN (no system_alerts writes)' : 'PERSISTED'}`,
  ].join('\n');

  return new Response(JSON.stringify({
    ok: true,
    summary,
    findings_count: allFindings.length,
    critical_count: critical,
    warning_count: warning,
    persisted: persist,
    per_row: perRow,
    findings: verbose ? allFindings : undefined,
  }, null, 2), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
