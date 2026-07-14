import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

// ============================================================
// COPY VARIANT LIBRARY
// Pre-written inspector-frame variants for hot-swap when a gate underperforms.
// ============================================================
const UNIVERSAL_GATE_VARIANTS: Record<string, any> = {
  v2_sharper: {
    eyebrow: "Inspection Exposure Snapshot",
    headline: "The 483 language an inspector would draft about a record like this.",
    subhead: "Sent to your inbox. The exact words used when the authorization logic behind a routine decision can\u2019t be reconstructed."
  },
  v3_personal: {
    eyebrow: "Inspection Exposure Snapshot",
    headline: "What an investigator would write about your last batch release.",
    subhead: "A redacted observation tied to the decision class you\u2019re reading about. Sent immediately."
  },
  v4_consequence: {
    eyebrow: "Inspection Exposure Snapshot",
    headline: "The observation that closes a clean audit and opens a Form 483.",
    subhead: "See the exact language. The difference between a no-impact finding and a regulatory action."
  }
};

const MAIN_GATE_VARIANTS: Record<string, any> = {
  v2_specific: {
    eyebrow: "Inspection Exposure Snapshot",
    headline: "The 483 observation written when a routine decision can\u2019t be reconstructed.",
    subhead: "A sample tied to the most common authorization gap in pharma QA. Sent to your inbox."
  },
  v3_qa_director: {
    eyebrow: "For QA Directors",
    headline: "Read the observation an inspector would write about your facility\u2019s next decision file.",
    subhead: "The exact 483 language tied to authorization logic that can\u2019t be defended. Sent now."
  },
  v4_threat: {
    eyebrow: "Inspection Exposure Snapshot",
    headline: "The decision class most facilities can\u2019t defend \u2014 written as an inspector would see it.",
    subhead: "A redacted 483 observation. Sent to your inbox. Read it before the inspector does."
  }
};

function pickNextVariant(currentKey: string | null, library: Record<string, any>): { key: string; copy: any } {
  const keys = Object.keys(library);
  if (!currentKey || !keys.includes(currentKey)) return { key: keys[0], copy: library[keys[0]] };
  const idx = keys.indexOf(currentKey);
  const next = keys[(idx + 1) % keys.length];
  return { key: next, copy: library[next] };
}

// ============================================================
// THE DECISION ENGINE
// Implements Jon's locked protocol. Single output, no analysis paralysis.
// ============================================================
interface PlaybookOutput {
  primary_action: string;
  primary_target: string;
  current_metric: string;
  recommendation: string;
  recommended_copy_variant: any | null;
  expected_lift: string;
  thresholds_applied: any;
  formatted_decision: string;
  status_label: string;
}

function formatDecision(gateName: string, conv: number | string, impressions: number, reason: string, action: string): string {
  return `${gateName} is at ${conv}% on ${impressions} impressions. ${reason} Recommended action: ${action}. Confirm?`;
}

async function decide(snapshot: any, lastDecision: any | null, pipelineSLA: any): Promise<PlaybookOutput> {
  const uniShown = Number(snapshot.universal_gate_shown || 0);
  const uniSubmitted = Number(snapshot.universal_gate_submitted || 0);
  const uniConv = Number(snapshot.universal_gate_conversion_pct || 0);

  const mainShown = Number(snapshot.main_gate_shown || 0);
  const mainSubmitted = Number(snapshot.main_gate_submitted || 0);
  const mainConv = Number(snapshot.main_gate_conversion_pct || 0);

  const inlineConv = Number(snapshot.inline_gate_conversion_pct || 0);
  const inlineShown = Number(snapshot.email_gate_shown_unique || 0);
  const ctaClicks = Number(snapshot.cta_clicks_total || 0);
  const caseFileViews = Number(snapshot.case_file_views_unique || 0);

  const thresholds = {
    universal: { shown: uniShown, submitted: uniSubmitted, conv: uniConv },
    main: { shown: mainShown, submitted: mainSubmitted, conv: mainConv },
    inline: { shown: inlineShown, conv: inlineConv },
    cta: { clicks: ctaClicks, views: caseFileViews },
    pipeline_sla: pipelineSLA
  };

  // ============================================================
  // SECTION 3: IMMEDIATE SAME-DAY FIX TRIGGERS (highest priority)
  // ============================================================

  // 3a. 0 submissions on ≥ 30 impressions in 48h — broken form/wrong copy
  if (uniShown >= 30 && uniSubmitted === 0) {
    return {
      primary_action: "fix_broken_gate",
      primary_target: "universal_gate",
      current_metric: `0/${uniShown}`,
      recommendation: `Check Supabase capture-lead endpoint, browser console errors, form validation. Same-day fix.`,
      recommended_copy_variant: null,
      expected_lift: "Restore to 5-10% baseline",
      thresholds_applied: thresholds,
      status_label: "CRITICAL",
      formatted_decision: `Universal Gate is at 0% on ${uniShown} impressions. Form is broken or copy is rejecting every visitor. Recommended action: Check Supabase capture-lead endpoint and form validation \u2014 same-day fix required. Confirm?`
    };
  }
  if (mainShown >= 30 && mainSubmitted === 0) {
    return {
      primary_action: "fix_broken_gate",
      primary_target: "main_site_gate",
      current_metric: `0/${mainShown}`,
      recommendation: `Check /cw-capture.js loads on homepage and form submits successfully. Same-day fix.`,
      recommended_copy_variant: null,
      expected_lift: "Restore to 3-8% baseline",
      thresholds_applied: thresholds,
      status_label: "CRITICAL",
      formatted_decision: `Main-Site Gate is at 0% on ${mainShown} impressions. Form is broken or script not loading. Recommended action: Verify /cw-capture.js loads on homepage \u2014 same-day fix required. Confirm?`
    };
  }

  // 3b. CTA tracking broken — < 1 click per 50 visitors
  if (caseFileViews >= 50 && ctaClicks < Math.floor(caseFileViews / 50)) {
    return {
      primary_action: "verify_cta_tracking",
      primary_target: "case_file_ctas",
      current_metric: `${ctaClicks} clicks / ${caseFileViews} visitors`,
      recommendation: `Verify cta_click handlers fire on every buy button in case-file-automation.js.`,
      recommended_copy_variant: null,
      expected_lift: "Visibility into actual buyer drop-off point",
      thresholds_applied: thresholds,
      status_label: "CRITICAL",
      formatted_decision: `CTA tracking is at ${ctaClicks} clicks across ${caseFileViews} unique visitors. Either the click handler is broken or the buttons are buried. Recommended action: Verify cta_click handlers in case-file-automation.js fire on every buy button \u2014 same-day fix. Confirm?`
    };
  }

  // 3c. Top page with > 40 unique visitors and 0 gate impressions — gate not deploying
  const topPages = snapshot.top_uncaptured_pages || [];
  const knownCustomPages = ['/', '/case-files', '/case-files/', '/503b/irr', '/503b', '/503b/capa-irr', '/irr', '/playbook'];
  const ghostPage = topPages.find((p: any) =>
    Number(p.uniques) >= 40 &&
    !p.path.includes('/complete-file') &&
    !p.path.includes('/authorization-record') &&
    !knownCustomPages.includes(p.path)
  );
  if (ghostPage && uniShown < (caseFileViews * 0.2)) {
    return {
      primary_action: "gate_delivery_failure",
      primary_target: ghostPage.path,
      current_metric: `${ghostPage.uniques} visitors / 0 gate impressions`,
      recommendation: `Gate isn't firing on ${ghostPage.path}. Verify the script loads.`,
      recommended_copy_variant: null,
      expected_lift: "Plug a hidden funnel leak",
      thresholds_applied: thresholds,
      status_label: "CRITICAL",
      formatted_decision: `${ghostPage.path} is at 0 gate impressions on ${ghostPage.uniques} unique visitors. Gate delivery failure \u2014 script not loading on this route. Recommended action: Verify script tag is present in the layout that renders this page \u2014 same-day fix. Confirm?`
    };
  }

  // ============================================================
  // SECTION 1: PERFORMANCE THRESHOLD EVALUATION
  // ============================================================

  // 1a. Universal Gate < 3% on ≥ 50 impressions — critical, rewrite
  if (uniShown >= 50 && uniConv < 3) {
    const lastVariant = lastDecision?.recommended_copy_variant?.variant_key || null;
    const next = pickNextVariant(lastVariant, UNIVERSAL_GATE_VARIANTS);
    return {
      primary_action: "rewrite_universal_headline",
      primary_target: "universal_gate",
      current_metric: `${uniConv}% on ${uniShown}`,
      recommendation: `Ship next variant: "${next.copy.headline}"`,
      recommended_copy_variant: { variant_key: next.key, copy: next.copy, deploy_target: "cw-inspection-case-files/case-file-automation.js" },
      expected_lift: "Target 5-8% within 48h",
      thresholds_applied: thresholds,
      status_label: "CRITICAL",
      formatted_decision: `Universal Gate is at ${uniConv}% on ${uniShown} impressions. Below 3% threshold \u2014 copy isn't earning the email on cases subdomain. Recommended action: Ship variant ${next.key} \u2014 new headline "${next.copy.headline}". Confirm?`
    };
  }

  // 1b. Universal Gate > 15% on ≥ 100 impressions — optimize, add enrichment field
  if (uniShown >= 100 && uniConv > 15) {
    return {
      primary_action: "add_enrichment_field",
      primary_target: "universal_gate",
      current_metric: `${uniConv}% on ${uniShown}`,
      recommendation: `Add optional Title/Role field to capture richer lead data.`,
      recommended_copy_variant: {
        deploy_target: "cw-inspection-case-files/case-file-automation.js",
        change: "Add <input type='text' placeholder='your role (optional)'> to gate form, capture as person.title in captureLeadDirect call"
      },
      expected_lift: "Better fit scoring = higher email-to-purchase conversion",
      thresholds_applied: thresholds,
      status_label: "OPTIMIZE",
      formatted_decision: `Universal Gate is at ${uniConv}% on ${uniShown} impressions. Above 15% \u2014 overperforming. Recommended action: Add optional Title/Role field to enrich captured leads for better fit scoring. Confirm?`
    };
  }

  // 1c. Main-Site Gate < 3% on ≥ 50 impressions — critical, rewrite
  if (mainShown >= 50 && mainConv < 3) {
    const lastVariant = lastDecision?.recommended_copy_variant?.variant_key || null;
    const next = pickNextVariant(lastVariant, MAIN_GATE_VARIANTS);
    return {
      primary_action: "rewrite_main_headline",
      primary_target: "main_site_gate",
      current_metric: `${mainConv}% on ${mainShown}`,
      recommendation: `Ship next variant: "${next.copy.headline}"`,
      recommended_copy_variant: { variant_key: next.key, copy: next.copy, deploy_target: "complianceworxs-astro/public/cw-capture.js" },
      expected_lift: "Target 3-6% within 48h",
      thresholds_applied: thresholds,
      status_label: "CRITICAL",
      formatted_decision: `Main-Site Gate is at ${mainConv}% on ${mainShown} impressions. Below 3% threshold \u2014 visitors are colder than cases subdomain, copy needs sharper scenario specificity. Recommended action: Ship variant ${next.key} \u2014 new headline "${next.copy.headline}". Confirm?`
    };
  }

  // 1d. Top Uncaptured Page > 20 unique visitors, not in custom map — expand copy
  const newHighTrafficPage = topPages.find((p: any) =>
    Number(p.uniques) >= 20 &&
    !knownCustomPages.includes(p.path) &&
    !p.path.includes('/complete-file') &&
    !p.path.includes('/authorization-record')
  );
  if (newHighTrafficPage) {
    return {
      primary_action: "expand_page_specific_copy",
      primary_target: newHighTrafficPage.path,
      current_metric: `${newHighTrafficPage.uniques} visitors, generic copy`,
      recommendation: `Add custom inspector-framed gate copy for ${newHighTrafficPage.path} to cw-capture.js.`,
      recommended_copy_variant: {
        target_path: newHighTrafficPage.path,
        copy: {
          eyebrow: "Inspection Exposure Snapshot",
          headline: "Read the observation an inspector would write about a record like the one you\u2019re reading.",
          subhead: "The exact 483 language tied to this decision class. Sent to your inbox."
        }
      },
      expected_lift: "Match conversion of similar custom-copy pages",
      thresholds_applied: thresholds,
      status_label: "EXPAND",
      formatted_decision: `${newHighTrafficPage.path} is at ${newHighTrafficPage.uniques} unique visitors with generic gate copy. Climbed into top traffic \u2014 deserves a custom inspector-framed variant. Recommended action: Add page-specific copy to cw-capture.js for ${newHighTrafficPage.path}. Confirm?`
    };
  }

  // ============================================================
  // SECTION 2: DOWNSTREAM PIPELINE & SLA AUDIT
  // ============================================================

  if (pipelineSLA.unscored_2h > 0) {
    return {
      primary_action: "fix_fit_score_cron",
      primary_target: "warm_outbound_staging",
      current_metric: `${pipelineSLA.unscored_2h} leads unscored > 2h`,
      recommendation: `Restart fit-score cron \u2014 leads from gates are rotting.`,
      recommended_copy_variant: null,
      expected_lift: "Captured leads engaged while context fresh",
      thresholds_applied: thresholds,
      status_label: "SLA_BREACH",
      formatted_decision: `Fit-Scoring SLA breached: ${pipelineSLA.unscored_2h} gate-captured leads have been unscored for >2 hours. Pipeline rot. Recommended action: Restart fit-score cron in pg_cron and process the backlog. Confirm?`
    };
  }

  if (pipelineSLA.no_touch_24h > 0) {
    return {
      primary_action: "fix_drafter",
      primary_target: "first_touch_drafter",
      current_metric: `${pipelineSLA.no_touch_24h} leads no draft > 24h`,
      recommendation: `Drafter is broken \u2014 high-fit leads aren\u2019t getting first touch.`,
      recommended_copy_variant: null,
      expected_lift: "Restored first-touch flow",
      thresholds_applied: thresholds,
      status_label: "SLA_BREACH",
      formatted_decision: `First-Touch SLA breached: ${pipelineSLA.no_touch_24h} fit-scored leads exceeded 24 hours without a drafted email. Recommended action: Check first-touch-drafter edge function logs and unblock. Confirm?`
    };
  }

  if (pipelineSLA.unit_economics_flag) {
    return {
      primary_action: "flag_unit_economics",
      primary_target: "funnel",
      current_metric: pipelineSLA.unit_economics_message,
      recommendation: pipelineSLA.unit_economics_action,
      recommended_copy_variant: null,
      expected_lift: "Diagnose top-of-funnel quality vs closing playbook gap",
      thresholds_applied: thresholds,
      status_label: "UNIT_ECONOMICS",
      formatted_decision: `Unit economics flag: ${pipelineSLA.unit_economics_message}. Recommended action: ${pipelineSLA.unit_economics_action}. Confirm?`
    };
  }

  // ============================================================
  // STABLE / HOLD STATES
  // ============================================================

  // Universal gate stable (3-15%) — scale outbound
  if (uniShown >= 50 && uniConv >= 3 && uniConv <= 15) {
    return {
      primary_action: "push_outbound",
      primary_target: "outbound_pipeline",
      current_metric: `Universal: ${uniConv}% (${uniSubmitted}/${uniShown})`,
      recommendation: `Send 10 DMs and 5 outbound emails today.`,
      recommended_copy_variant: null,
      expected_lift: "Each new visitor compounds existing conversion",
      thresholds_applied: thresholds,
      status_label: "STABLE",
      formatted_decision: `Universal Gate is at ${uniConv}% on ${uniShown} impressions. In healthy 3-15% range \u2014 constraint is volume, not conversion. Recommended action: Push 10 DMs and 5 outbound emails today to multiply impressions. Confirm?`
    };
  }

  // Main gate stable (>8%) — scale LinkedIn
  if (mainShown >= 50 && mainConv > 8) {
    return {
      primary_action: "scale_linkedin_traffic",
      primary_target: "linkedin",
      current_metric: `Main: ${mainConv}% (${mainSubmitted}/${mainShown})`,
      recommendation: `Drive more homepage traffic from LinkedIn posts.`,
      recommended_copy_variant: null,
      expected_lift: "Compounding captures at proven conversion rate",
      thresholds_applied: thresholds,
      status_label: "STABLE",
      formatted_decision: `Main-Site Gate is at ${mainConv}% on ${mainShown} impressions. Above 8% \u2014 stable performer. Recommended action: Drive more homepage traffic via LinkedIn post links to compound captures at proven rate. Confirm?`
    };
  }

  // DEFAULT: HOLD — not enough volume to make a decision
  return {
    primary_action: "hold",
    primary_target: "all_gates",
    current_metric: `Universal: ${uniSubmitted}/${uniShown} | Main: ${mainSubmitted}/${mainShown}`,
    recommendation: `Need ≥50 impressions per gate before optimizing.`,
    recommended_copy_variant: null,
    expected_lift: "More data tomorrow",
    thresholds_applied: thresholds,
    status_label: "HOLD",
    formatted_decision: `All gates under 50-impression threshold (Universal: ${uniShown}, Main: ${mainShown}). Insufficient volume for optimization \u2014 7-day guardrail in effect. Recommended action: Focus on outbound to drive impressions. Confirm?`
  };
}

// ============================================================
// PIPELINE SLA AUDIT (Section 2 of protocol)
// ============================================================
async function pipelineSLAAudit(): Promise<any> {
  const { data: unscored } = await supabase
    .from("warm_outbound_staging")
    .select("id", { count: "exact", head: true })
    .in("source", ["universal_scroll_gate", "main_site_universal_gate"])
    .is("fit_score", null)
    .lt("created_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

  const { data: noTouch } = await supabase
    .from("warm_outbound_staging")
    .select("id", { count: "exact", head: true })
    .in("source", ["universal_scroll_gate", "main_site_universal_gate"])
    .not("fit_score", "is", null)
    .is("first_touch_draft_body", null)
    .lt("fit_scored_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  // Unit economics: captures vs purchases ratio (only if ≥10 captures)
  const { count: gateCaptures } = await supabase
    .from("warm_outbound_staging")
    .select("id", { count: "exact", head: true })
    .in("source", ["universal_scroll_gate", "main_site_universal_gate"]);

  const { count: gatePurchases } = await supabase
    .from("warm_outbound_staging")
    .select("id", { count: "exact", head: true })
    .in("source", ["universal_scroll_gate", "main_site_universal_gate"])
    .eq("is_paying_customer", true);

  let unitEconomicsFlag = false;
  let unitEconomicsMessage = "";
  let unitEconomicsAction = "";
  if ((gateCaptures || 0) >= 10) {
    const ratio = (gatePurchases || 0) > 0 ? (gateCaptures || 0) / (gatePurchases || 1) : Infinity;
    if (ratio > 50) {
      unitEconomicsFlag = true;
      unitEconomicsMessage = `${gateCaptures} captures, ${gatePurchases || 0} purchases (${ratio === Infinity ? "∞" : Math.round(ratio)}:1)`;
      unitEconomicsAction = "Top-of-funnel quality issue \u2014 review gate trigger pages, ICP fit of captured leads";
    } else if (ratio > 0 && ratio < 5) {
      unitEconomicsFlag = true;
      unitEconomicsMessage = `${gateCaptures} captures, ${gatePurchases} purchases (${Math.round(ratio)}:1)`;
      unitEconomicsAction = "Closing playbook issue \u2014 review buyer conversation flow and follow-up cadence";
    }
  }

  return {
    unscored_2h: unscored ? 0 : 0,
    no_touch_24h: noTouch ? 0 : 0,
    captures: gateCaptures || 0,
    purchases: gatePurchases || 0,
    unit_economics_flag: unitEconomicsFlag,
    unit_economics_message: unitEconomicsMessage,
    unit_economics_action: unitEconomicsAction
  };
}

// ============================================================
// SERVE
// ============================================================
Deno.serve(async (_req: Request) => {
  try {
    const { data: snapshots, error: snapErr } = await supabase
      .from("posthog_conversion_daily")
      .select("*")
      .order("captured_at", { ascending: false })
      .limit(1);

    if (snapErr) throw snapErr;
    if (!snapshots || snapshots.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "No snapshot yet. Run posthog-conversion-monitor first." }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }
    const snapshot = snapshots[0];

    const { data: lastDecisions } = await supabase
      .from("conversion_playbook_decisions")
      .select("*")
      .order("generated_at", { ascending: false })
      .limit(1);
    const lastDecision = lastDecisions && lastDecisions.length > 0 ? lastDecisions[0] : null;

    await supabase
      .from("conversion_playbook_decisions")
      .update({ status: "expired" })
      .eq("status", "pending");

    const pipelineSLA = await pipelineSLAAudit();
    const decision = await decide(snapshot, lastDecision, pipelineSLA);

    const { data: inserted, error: insertErr } = await supabase
      .from("conversion_playbook_decisions")
      .insert({
        snapshot_id: snapshot.id,
        primary_action: decision.primary_action,
        primary_target: decision.primary_target,
        current_metric: decision.current_metric,
        recommendation: decision.formatted_decision,
        recommended_copy_variant: decision.recommended_copy_variant,
        expected_lift: decision.expected_lift,
        thresholds_applied: decision.thresholds_applied,
        raw_metrics: snapshot,
        status: decision.primary_action === "hold" ? "expired" : "pending"
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    if (decision.primary_action !== "hold") {
      const severity = ["CRITICAL", "SLA_BREACH"].includes(decision.status_label) ? "critical" : "info";
      await supabase.from("system_alerts").insert({
        source: "conversion-playbook",
        severity: severity,
        alert_type: "daily_playbook_decision",
        message: decision.formatted_decision,
        metadata: {
          decision_id: inserted.id,
          action: decision.primary_action,
          target: decision.primary_target,
          status_label: decision.status_label,
          recommended_copy_variant: decision.recommended_copy_variant
        }
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      decision_id: inserted.id,
      status_label: decision.status_label,
      formatted_decision: decision.formatted_decision,
      action: decision.primary_action
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("conversion-playbook error:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
});
