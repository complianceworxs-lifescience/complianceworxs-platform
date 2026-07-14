// outbound-optimizer — MAPE-K self-optimizing outbound loop
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supa = createClient(SUPABASE_URL, SERVICE_KEY);

async function getConfig(key, fallback) {
  const { data } = await supa.from("optimizer_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? fallback;
}

async function setConfig(key, value, reasoning) {
  await supa.from("optimizer_config").upsert({
    key, value, reasoning,
    updated_at: new Date().toISOString(),
    updated_by: "outbound-optimizer",
  });
}

async function logDecision(mode, executed, d) {
  // Table schema: id, decided_at, mode, stage, metric_name, metric_value,
  // sample_size, parameter_changed, old_value, new_value, reasoning,
  // reversal_trigger, executed, reverted_at, reverted_reason
  const { error } = await supa.from("optimizer_decisions").insert({
    mode,
    stage: "outbound",
    metric_name: d.metric_name,
    metric_value: d.metric_value != null ? Number(d.metric_value) : null,
    sample_size: d.sample_size ? Number(d.sample_size) : null,
    parameter_changed: d.parameter_changed ?? null,
    old_value: d.old_value !== undefined ? d.old_value : null,
    new_value: d.new_value !== undefined ? d.new_value : null,
    reasoning: d.reasoning,
    reversal_trigger: d.reversal_condition ?? null,
    executed,
  });
  if (error) console.error("[optimizer] logDecision error:", JSON.stringify(error));
  return error;
}

async function monitor() {
  const { error: snapErr } = await supa.rpc("capture_funnel_snapshot", { p_window_days: 7 });
  if (snapErr) console.error("[optimizer] snapshot error:", JSON.stringify(snapErr));

  const { data: snap } = await supa
    .from("optimizer_funnel_snapshots")
    .select("*")
    .order("captured_at", { ascending: false })
    .limit(1)
    .single();

  const { data: prev } = await supa
    .from("optimizer_funnel_snapshots")
    .select("*")
    .lt("captured_at", new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString())
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { count: stranded } = await supa
    .from("warm_outbound_staging")
    .select("id", { count: "exact", head: true })
    .gte("fit_score", 70)
    .is("dm_drafted_at", null)
    .is("archived_at", null)
    .lt("fit_scored_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());

  return { snap, prev, stranded: stranded ?? 0 };
}

async function analyze(mon) {
  const decisions = [];
  const { snap, prev } = mon;
  if (!snap) return decisions;

  const accept_rate = snap.accept_rate ? Number(snap.accept_rate) : null;
  const dms_sent = snap.dms_sent ?? 0;

  // Rule 1: stranded leads
  if (mon.stranded >= 20) {
    decisions.push({
      metric_name: "stranded_high_fit_leads",
      metric_value: mon.stranded,
      sample_size: mon.stranded,
      parameter_changed: "readiness_allow_fallback",
      old_value: await getConfig("readiness_allow_fallback", true),
      new_value: true,
      reasoning: `${mon.stranded} high-fit leads stranded >48h. Force-enable readiness fallback.`,
      reversal_condition: "stranded count drops below 5",
    });
  }

  // Rule 2: accept rate too low
  if (accept_rate !== null && dms_sent >= 30 && accept_rate < 0.15) {
    const cur = Number(await getConfig("fit_score_threshold", 70));
    const next = Math.min(cur + 5, 90);
    decisions.push({
      metric_name: "accept_rate",
      metric_value: accept_rate,
      sample_size: dms_sent,
      parameter_changed: "fit_score_threshold",
      old_value: cur,
      new_value: next,
      reasoning: `Accept rate ${(accept_rate*100).toFixed(1)}% on ${dms_sent} sends below 15% floor. Tightening threshold ${cur}→${next}.`,
      reversal_condition: "accept_rate above 25% for 7 days",
    });
  }

  // Rule 3: accept rate strong
  if (accept_rate !== null && dms_sent >= 30 && accept_rate > 0.35) {
    const cur = Number(await getConfig("fit_score_threshold", 70));
    const next = Math.max(cur - 5, 50);
    decisions.push({
      metric_name: "accept_rate",
      metric_value: accept_rate,
      sample_size: dms_sent,
      parameter_changed: "fit_score_threshold",
      old_value: cur,
      new_value: next,
      reasoning: `Accept rate ${(accept_rate*100).toFixed(1)}% strong. Broadening threshold ${cur}→${next} for volume.`,
      reversal_condition: "accept_rate drops below 20% for 3 days",
    });
  }

  // Rule 4: budget utilization
  const cur_budget = Number(await getConfig("daily_dm_budget", 10));
  if (dms_sent >= cur_budget * 5 * 0.9 && accept_rate !== null && accept_rate >= 0.25) {
    const next_budget = Math.min(Math.ceil(cur_budget * 1.2), 25);
    decisions.push({
      metric_name: "budget_utilization",
      metric_value: dms_sent / (cur_budget * 5),
      sample_size: dms_sent,
      parameter_changed: "daily_dm_budget",
      old_value: cur_budget,
      new_value: next_budget,
      reasoning: `Sending at capacity with ${(accept_rate*100).toFixed(1)}% accept. Expanding budget ${cur_budget}→${next_budget}/day.`,
      reversal_condition: "accept_rate drops below 20%",
    });
  }

  // Rule 5: per-cohort pause
  const cohorts = snap.per_cohort_stats ?? {};
  const min_accept = Number(await getConfig("min_accept_rate_threshold", 0.15));
  const paused = await getConfig("paused_cohorts", []);
  const new_paused = [...(Array.isArray(paused) ? paused : [])];

  for (const [cohort, stats] of Object.entries(cohorts)) {
    if (!stats.sent || stats.sent < 15) continue;
    if (stats.accept_rate !== null && stats.accept_rate < min_accept && !new_paused.includes(cohort)) {
      new_paused.push(cohort);
      decisions.push({
        metric_name: "cohort_accept_rate",
        metric_value: stats.accept_rate,
        sample_size: stats.sent,
        parameter_changed: "paused_cohorts",
        old_value: paused,
        new_value: new_paused,
        reasoning: `Cohort "${cohort}" accept rate ${(stats.accept_rate*100).toFixed(1)}% on ${stats.sent} sends below floor. Pausing.`,
        reversal_condition: "Manual review or 14 days elapsed",
      });
    }
  }

  // Rule 6: lead supply drop
  if (prev && snap.leads_ingested !== null && prev.leads_ingested > 0) {
    const pct = (snap.leads_ingested - prev.leads_ingested) / prev.leads_ingested;
    if (pct < -0.3 && snap.leads_ingested < 30) {
      decisions.push({
        metric_name: "lead_supply_drop",
        metric_value: pct,
        sample_size: snap.leads_ingested,
        parameter_changed: null,
        old_value: prev.leads_ingested,
        new_value: snap.leads_ingested,
        reasoning: `Lead ingestion dropped ${(pct*100).toFixed(0)}% WoW. Source recovery needed — manual review required.`,
        reversal_condition: "ingestion recovers above prior baseline",
      });
    }
  }

  return decisions;
}

async function execute(decisions, mode) {
  const live_after = await getConfig("optimizer_live_after", null);
  if (mode === "shadow" && live_after && new Date(live_after) <= new Date()) {
    await setConfig("optimizer_mode", "live", "Auto-promoted from shadow after 14-day evaluation");
    mode = "live";
  }

  let executed_count = 0;
  const log_errors = [];
  for (const d of decisions) {
    const do_execute = mode === "live" && d.parameter_changed !== null;
    if (do_execute) {
      await setConfig(d.parameter_changed, d.new_value, d.reasoning);
      executed_count++;
    }
    const err = await logDecision(mode, do_execute, d);
    if (err) log_errors.push({ metric: d.metric_name, error: err });
  }

  return { count: decisions.length, mode, executed: executed_count, log_errors };
}

Deno.serve(async (req) => {
  try {
    const mode_raw = await getConfig("optimizer_mode", "shadow");
    const mode = typeof mode_raw === "string" ? mode_raw : "shadow";

    if (mode === "disabled") {
      return new Response(JSON.stringify({ skipped: true }), { headers: { "Content-Type": "application/json" } });
    }

    const mon = await monitor();
    const decisions = await analyze(mon);
    const result = await execute(decisions, mode);

    return new Response(JSON.stringify({
      ok: true,
      mode: result.mode,
      decisions_count: result.count,
      decisions_executed: result.executed,
      log_errors: result.log_errors,
      stranded_high_fit: mon.stranded,
      funnel: mon.snap ? {
        leads_ingested: mon.snap.leads_ingested,
        dms_sent: mon.snap.dms_sent,
        accept_rate: mon.snap.accept_rate,
        reply_rate: mon.snap.reply_rate,
      } : null,
      decisions,
    }, null, 2), { headers: { "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
