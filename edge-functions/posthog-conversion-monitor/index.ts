// posthog-conversion-monitor v6 — May 24 2026
// V6 CHANGES:
//   1. Adds the /reconstruction diagnostic funnel as a first-class snapshot section.
//      The /reconstruction page is a structured 8-question diagnostic, not a gate —
//      its conversion was previously invisible to this monitor (showed as 'top uncaptured page'
//      with 74 visitors / 0 captures). It's actually the second-best converting surface
//      on the site, behind direct Stripe links.
//   2. Filters /reconstruction OUT of top_uncaptured_pages so the briefing stops
//      flagging it as a leak.
//   3. Adds a warning alert if reconstruction completers click through but case-file
//      purchases stay at zero — that's the real downstream conversion gap.
//
// V5 / earlier: unchanged. See git history.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const POSTHOG_HOST = "https://us.posthog.com";
const POSTHOG_PROJECT_ID = "373320";

const POSTHOG_PERSONAL_API_KEY =
  Deno.env.get("POSTHOG_PERSONAL_API_KEY") ||
  Deno.env.get("POSTHOG_API_KEY") ||
  Deno.env.get("POSTHOG_KEY") ||
  Deno.env.get("POSTHOG_PROJECT_API_KEY") ||
  Deno.env.get("POSTHOG_PERSONAL_KEY") ||
  "";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

async function runHogQL(query: string): Promise<any> {
  const res = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${POSTHOG_PERSONAL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } })
  });
  if (!res.ok) {
    throw new Error(`PostHog API ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.results || [];
}

function firstRow(rows: any[]): any[] | null {
  return rows && rows.length > 0 ? rows[0] : null;
}

function pct(numerator: number, denominator: number): number {
  if (!denominator || denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

Deno.serve(async (_req: Request) => {
  const envDiag = {
    has_POSTHOG_PERSONAL_API_KEY: !!Deno.env.get("POSTHOG_PERSONAL_API_KEY"),
    has_POSTHOG_API_KEY: !!Deno.env.get("POSTHOG_API_KEY"),
    has_POSTHOG_KEY: !!Deno.env.get("POSTHOG_KEY"),
    key_length: POSTHOG_PERSONAL_API_KEY.length,
    key_prefix: POSTHOG_PERSONAL_API_KEY.slice(0, 8)
  };

  try {
    if (!POSTHOG_PERSONAL_API_KEY) {
      return new Response(JSON.stringify({
        ok: false,
        error: "No PostHog API key found in env",
        env_diagnostic: envDiag
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    // ---------- Existing case-file / gate metrics ----------
    const caseFileViewsRow = firstRow(await runHogQL(`SELECT count() AS n, uniq(distinct_id) AS u FROM events WHERE event = 'case_file_view' AND timestamp > now() - INTERVAL 7 DAY`));
    const caseFileViewsTotal = caseFileViewsRow ? Number(caseFileViewsRow[0]) : 0;
    const caseFileViewsUnique = caseFileViewsRow ? Number(caseFileViewsRow[1]) : 0;

    const lockRow = firstRow(await runHogQL(`SELECT count() AS n, uniq(distinct_id) AS u FROM events WHERE event = 'lock_view' AND timestamp > now() - INTERVAL 7 DAY`));
    const lockViewsTotal = lockRow ? Number(lockRow[0]) : 0;
    const lockViewsUnique = lockRow ? Number(lockRow[1]) : 0;

    const gateShownRow = firstRow(await runHogQL(`SELECT uniq(distinct_id) AS u FROM events WHERE event = 'lock_view' AND properties.overlay_type = 'exposure_snapshot_gate' AND timestamp > now() - INTERVAL 7 DAY`));
    const emailGateShownUnique = gateShownRow ? Number(gateShownRow[0]) : 0;

    const gateSubmittedRow = firstRow(await runHogQL(`SELECT count() AS n FROM events WHERE event = 'email_gate_submitted' AND timestamp > now() - INTERVAL 7 DAY`));
    const emailGateSubmitted = gateSubmittedRow ? Number(gateSubmittedRow[0]) : 0;

    const uniShownRow = firstRow(await runHogQL(`SELECT count() AS n FROM events WHERE event = 'universal_gate_shown' AND timestamp > now() - INTERVAL 7 DAY`));
    const universalGateShown = uniShownRow ? Number(uniShownRow[0]) : 0;

    const uniSubmittedRow = firstRow(await runHogQL(`SELECT count() AS n FROM events WHERE event = 'universal_gate_submitted' AND timestamp > now() - INTERVAL 7 DAY`));
    const universalGateSubmitted = uniSubmittedRow ? Number(uniSubmittedRow[0]) : 0;

    const uniDismissedRow = firstRow(await runHogQL(`SELECT count() AS n FROM events WHERE event = 'universal_gate_dismissed' AND timestamp > now() - INTERVAL 7 DAY`));
    const universalGateDismissed = uniDismissedRow ? Number(uniDismissedRow[0]) : 0;

    const mainShownRow = firstRow(await runHogQL(`SELECT count() AS n FROM events WHERE event = 'main_gate_shown' AND timestamp > now() - INTERVAL 7 DAY`));
    const mainGateShown = mainShownRow ? Number(mainShownRow[0]) : 0;

    const mainSubmittedRow = firstRow(await runHogQL(`SELECT count() AS n FROM events WHERE event = 'main_gate_submitted' AND timestamp > now() - INTERVAL 7 DAY`));
    const mainGateSubmitted = mainSubmittedRow ? Number(mainSubmittedRow[0]) : 0;

    const mainDismissedRow = firstRow(await runHogQL(`SELECT count() AS n FROM events WHERE event = 'main_gate_dismissed' AND timestamp > now() - INTERVAL 7 DAY`));
    const mainGateDismissed = mainDismissedRow ? Number(mainDismissedRow[0]) : 0;

    const ctaRow = firstRow(await runHogQL(`SELECT count() AS n FROM events WHERE event = 'cta_click' AND timestamp > now() - INTERVAL 7 DAY`));
    const ctaClicksTotal = ctaRow ? Number(ctaRow[0]) : 0;

    const captureRow = firstRow(await runHogQL(`SELECT count() AS n FROM events WHERE event = 'email_captured' AND timestamp > now() - INTERVAL 7 DAY`));
    const emailCapturesTotal = captureRow ? Number(captureRow[0]) : 0;

    const purchaseRow = firstRow(await runHogQL(`SELECT count() AS n FROM events WHERE event = 'purchase' AND timestamp > now() - INTERVAL 7 DAY`));
    const purchasesTotal = purchaseRow ? Number(purchaseRow[0]) : 0;

    const enrichRow = firstRow(await runHogQL(`SELECT count() AS n FROM events WHERE event = 'lead_enrichment_failed' AND timestamp > now() - INTERVAL 7 DAY`));
    const leadEnrichmentFailed = enrichRow ? Number(enrichRow[0]) : 0;

    // ---------- v6: /reconstruction diagnostic funnel ----------
    const reconPVRow = firstRow(await runHogQL(`
      SELECT count() AS n, uniq(distinct_id) AS u
      FROM events WHERE event = '$pageview'
        AND properties.$pathname = '/reconstruction'
        AND timestamp > now() - INTERVAL 7 DAY
    `));
    const reconPageviewsUnique = reconPVRow ? Number(reconPVRow[1]) : 0;

    const reconTermsRow = firstRow(await runHogQL(`SELECT uniq(distinct_id) AS u FROM events WHERE event = 'reconstruction_terms_accepted' AND timestamp > now() - INTERVAL 7 DAY`));
    const reconTermsAccepted = reconTermsRow ? Number(reconTermsRow[0]) : 0;

    const reconDecisionRow = firstRow(await runHogQL(`SELECT uniq(distinct_id) AS u FROM events WHERE event = 'reconstruction_decision_type_selected' AND timestamp > now() - INTERVAL 7 DAY`));
    const reconDecisionSelected = reconDecisionRow ? Number(reconDecisionRow[0]) : 0;

    const reconComingSoonRow = firstRow(await runHogQL(`SELECT uniq(distinct_id) AS u FROM events WHERE event = 'reconstruction_coming_soon_shown' AND timestamp > now() - INTERVAL 7 DAY`));
    const reconComingSoonShown = reconComingSoonRow ? Number(reconComingSoonRow[0]) : 0;

    // Started CAPA = decision_type_selected with decision_type = 'capa-effectiveness'
    const reconCapaStartedRow = firstRow(await runHogQL(`
      SELECT uniq(distinct_id) AS u FROM events
      WHERE event = 'reconstruction_decision_type_selected'
        AND properties.decision_type = 'capa-effectiveness'
        AND timestamp > now() - INTERVAL 7 DAY
    `));
    const reconCapaStarted = reconCapaStartedRow ? Number(reconCapaStartedRow[0]) : 0;

    const reconCompletedRow = firstRow(await runHogQL(`SELECT uniq(distinct_id) AS u FROM events WHERE event = 'reconstruction_completed' AND timestamp > now() - INTERVAL 7 DAY`));
    const reconCompleted = reconCompletedRow ? Number(reconCompletedRow[0]) : 0;

    const reconRoutedRow = firstRow(await runHogQL(`SELECT uniq(distinct_id) AS u FROM events WHERE event = 'reconstruction_route_taken' AND timestamp > now() - INTERVAL 7 DAY`));
    const reconRouted = reconRoutedRow ? Number(reconRoutedRow[0]) : 0;

    const reconObsRows = await runHogQL(`
      SELECT properties.observation_key AS key, count() AS n
      FROM events WHERE event = 'reconstruction_completed'
        AND timestamp > now() - INTERVAL 7 DAY
      GROUP BY key ORDER BY n DESC
    `);
    const reconObservationBreakdown = reconObsRows.map((r: any[]) => ({ key: r[0], n: Number(r[1]) }));

    const reconCompletionPct = pct(reconCompleted, reconPageviewsUnique);
    const reconRoutePct = pct(reconRouted, reconPageviewsUnique);
    const reconDeadDropdownPct = pct(reconComingSoonShown, reconDecisionSelected);

    // ---------- Top pages (v6: exclude /reconstruction so it stops looking like a leak) ----------
    const topPagesRows = await runHogQL(`
      SELECT properties.$pathname AS path, count() AS views, uniq(distinct_id) AS uniques
      FROM events WHERE event = '$pageview'
        AND properties.$pathname NOT IN ('/reconstruction')
        AND timestamp > now() - INTERVAL 7 DAY
      GROUP BY path ORDER BY views DESC LIMIT 15
    `);
    const topUncapturedPages = topPagesRows.map((r: any[]) => ({ path: r[0], views: Number(r[1]), uniques: Number(r[2]) }));

    const inlineConv = pct(emailGateSubmitted, emailGateShownUnique);
    const uniConv = pct(universalGateSubmitted, universalGateShown);
    const mainConv = pct(mainGateSubmitted, mainGateShown);

    const { data: priorSnapshots } = await supabase.from("posthog_conversion_daily").select("*").order("captured_at", { ascending: false }).limit(1);
    const prior = priorSnapshots && priorSnapshots.length > 0 ? priorSnapshots[0] : null;

    const delta = prior ? {
      case_file_views_unique: caseFileViewsUnique - (prior.case_file_views_unique || 0),
      universal_gate_submitted: universalGateSubmitted - (prior.universal_gate_submitted || 0),
      main_gate_submitted: mainGateSubmitted - (prior.main_gate_submitted || 0),
      email_captures_total: emailCapturesTotal - (prior.email_captures_total || 0),
      purchases_total: purchasesTotal - (prior.purchases_total || 0),
      reconstruction_completed: reconCompleted - (prior.reconstruction_completed || 0),
      reconstruction_routed: reconRouted - (prior.reconstruction_routed || 0)
    } : null;

    const { data: inserted, error } = await supabase.from("posthog_conversion_daily").insert({
      window_days: 7,
      case_file_views_total: caseFileViewsTotal,
      case_file_views_unique: caseFileViewsUnique,
      lock_views_total: lockViewsTotal,
      lock_views_unique: lockViewsUnique,
      email_gate_shown_unique: emailGateShownUnique,
      email_gate_submitted: emailGateSubmitted,
      inline_gate_conversion_pct: inlineConv,
      universal_gate_shown: universalGateShown,
      universal_gate_submitted: universalGateSubmitted,
      universal_gate_dismissed: universalGateDismissed,
      universal_gate_conversion_pct: uniConv,
      main_gate_shown: mainGateShown,
      main_gate_submitted: mainGateSubmitted,
      main_gate_dismissed: mainGateDismissed,
      main_gate_conversion_pct: mainConv,
      cta_clicks_total: ctaClicksTotal,
      email_captures_total: emailCapturesTotal,
      purchases_total: purchasesTotal,
      lead_enrichment_failed: leadEnrichmentFailed,
      top_uncaptured_pages: topUncapturedPages,
      delta_vs_prior: delta,
      reconstruction_pageviews_unique: reconPageviewsUnique,
      reconstruction_terms_accepted: reconTermsAccepted,
      reconstruction_decision_selected: reconDecisionSelected,
      reconstruction_coming_soon_shown: reconComingSoonShown,
      reconstruction_capa_started: reconCapaStarted,
      reconstruction_completed: reconCompleted,
      reconstruction_routed: reconRouted,
      reconstruction_completion_pct: reconCompletionPct,
      reconstruction_route_pct: reconRoutePct,
      reconstruction_dead_dropdown_pct: reconDeadDropdownPct,
      reconstruction_observation_breakdown: reconObservationBreakdown
    }).select().single();

    if (error) throw error;

    const alerts: any[] = [];
    if (universalGateShown >= 50 && uniConv < 5) {
      alerts.push({ source: "posthog-conversion-monitor", severity: "warning", message: `Universal gate conversion at ${uniConv}% over 7 days (${universalGateSubmitted}/${universalGateShown}). Below 5% threshold.`, metadata: { conversion_pct: uniConv, shown: universalGateShown, submitted: universalGateSubmitted } });
    }
    if (mainGateShown >= 50 && mainConv < 5) {
      alerts.push({ source: "posthog-conversion-monitor", severity: "warning", message: `Main-site gate conversion at ${mainConv}% over 7 days (${mainGateSubmitted}/${mainGateShown}). Below 5% threshold.`, metadata: { conversion_pct: mainConv, shown: mainGateShown, submitted: mainGateSubmitted } });
    }
    // v6: dead-dropdown alert. Half of engaged reconstruction users dropping at 'coming soon'
    // is a real conversion leak that we can fix by either hiding the non-CAPA options or building them.
    if (reconDecisionSelected >= 10 && reconDeadDropdownPct >= 40) {
      alerts.push({
        source: "posthog-conversion-monitor",
        severity: "warning",
        alert_type: "reconstruction_dead_dropdowns_dominant",
        message: `${reconDeadDropdownPct}% of /reconstruction visitors who picked a decision type hit 'coming soon' (${reconComingSoonShown}/${reconDecisionSelected}). Non-CAPA decision types are either taking ~half of engaged prospects out of the funnel.`,
        context: { dead_dropdown_pct: reconDeadDropdownPct, coming_soon_shown: reconComingSoonShown, decision_selected: reconDecisionSelected }
      });
    }
    // v6: warm-but-stranded alert. Reconstruction routes prospects to case file; if 5+ route and no case file purchases, we have a downstream gap.
    if (reconRouted >= 5 && purchasesTotal === 0) {
      alerts.push({
        source: "posthog-conversion-monitor",
        severity: "warning",
        alert_type: "reconstruction_routed_no_purchase",
        message: `${reconRouted} prospects completed /reconstruction and clicked through to case file, but 0 purchases in 7d. Downstream conversion gap on the case file landing page.`,
        context: { reconstruction_routed: reconRouted, purchases_total: purchasesTotal }
      });
    }
    if (alerts.length > 0) {
      // alert_type defaults to source if not specified — keep backwards compat
      const rows = alerts.map(a => ({
        source: a.source,
        severity: a.severity,
        alert_type: a.alert_type || a.source,
        message: a.message,
        context: a.context || a.metadata || null
      }));
      await supabase.from("system_alerts").insert(rows);
    }

    return new Response(JSON.stringify({
      ok: true,
      snapshot_id: inserted.id,
      env_diagnostic: envDiag,
      summary: {
        case_file_views_unique: caseFileViewsUnique,
        inline_gate_conversion_pct: inlineConv,
        universal_gate_conversion_pct: uniConv,
        main_gate_conversion_pct: mainConv,
        purchases_total: purchasesTotal,
        alerts_fired: alerts.length,
        reconstruction: {
          pageviews_unique: reconPageviewsUnique,
          terms_accepted: reconTermsAccepted,
          decision_selected: reconDecisionSelected,
          capa_started: reconCapaStarted,
          coming_soon_shown: reconComingSoonShown,
          completed: reconCompleted,
          routed: reconRouted,
          completion_pct: reconCompletionPct,
          route_pct: reconRoutePct,
          dead_dropdown_pct: reconDeadDropdownPct,
          observation_breakdown: reconObservationBreakdown
        }
      }
    }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
