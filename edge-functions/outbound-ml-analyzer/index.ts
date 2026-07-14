// outbound-ml-analyzer
// MAPE-K Layer 2 + 3: Clustering, A/B stats, RL reward signal
// Runs daily at 3:45 AM EDT (before optimizer at 4 AM)
// Objective function: maximize positive_reply_rate, constraint: unsubscribe_rate < 0.02

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const supa = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const WINDOW_DAYS = 30; // wider window for ML — need volume
const MIN_SENDS_FOR_STATS = 10; // minimum sends before computing rates
const MIN_SENDS_FOR_SIGNIFICANCE = 30; // minimum for statistical significance test
const UNSUBSCRIBE_CEILING = 0.02;

// ================================================================
// LAYER 1 SENSORS: backfill outbound_events from existing data
// (catches history before trigger existed)
// ================================================================
async function backfillSensorEvents() {
  // Only backfill events not already in the table
  const { count } = await supa.from('outbound_events').select('id', { count: 'exact', head: true });
  if ((count ?? 0) > 100) return; // already populated, skip

  const { data: leads } = await supa
    .from('warm_outbound_staging')
    .select('id, fit_score, cohort_label, role_function, linkedin_company_industry, linkedin_company_employees_count, linkedin_description, linkedin_headline, email, dm_draft_body, source, target_account_priority, readiness_status, enriched_at, fit_scored_at, dm_drafted_at, dm_connection_request_sent_at, dm_connection_accepted_at, dm_first_message_sent_at, dm_replied_at, delivery_status, replied_at')
    .not('enriched_at', 'is', null);

  if (!leads?.length) return;

  const events: any[] = [];
  for (const lead of leads) {
    const props = {
      fit_score: lead.fit_score,
      cohort_label: lead.cohort_label,
      role_function: lead.role_function,
      industry: lead.linkedin_company_industry,
      company_size: lead.linkedin_company_employees_count,
      linkedin_description_length: (lead.linkedin_description ?? '').length,
      linkedin_headline_present: !!lead.linkedin_headline,
      has_email: !!lead.email,
      dm_char_count: (lead.dm_draft_body ?? '').length,
      source: lead.source,
      target_account_priority: lead.target_account_priority,
      readiness_status: lead.readiness_status,
    };
    const map: [string, string | null][] = [
      ['enriched', lead.enriched_at],
      ['scored', lead.fit_scored_at],
      ['dm_drafted', lead.dm_drafted_at],
      ['connection_sent', lead.dm_connection_request_sent_at],
      ['connection_accepted', lead.dm_connection_accepted_at],
      ['message_sent', lead.dm_first_message_sent_at],
      ['reply_received', lead.dm_replied_at],
      ['email_sent', lead.delivery_status === 'sent' ? lead.fit_scored_at : null],
      ['email_bounced', lead.delivery_status === 'bounce' ? lead.fit_scored_at : null],
      ['email_replied', lead.replied_at],
    ];
    for (const [evt, ts] of map) {
      if (ts) events.push({ lead_id: lead.id, event_type: evt, occurred_at: ts, properties: props });
    }
  }

  // Insert in batches of 100
  for (let i = 0; i < events.length; i += 100) {
    await supa.from('outbound_events').insert(events.slice(i, i + 100));
  }
  console.log(`[ml] backfilled ${events.length} sensor events`);
}

// ================================================================
// LAYER 2: CLUSTERING — per-segment performance stats
// Segments: role_function, industry, cohort_label, fit_score_band, company_size_band
// ================================================================
async function runClustering() {
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Pull all leads with enough data, last WINDOW_DAYS
  const { data: leads } = await supa
    .from('warm_outbound_staging')
    .select('id, fit_score, cohort_label, role_function, linkedin_company_industry, linkedin_company_employees_count, dm_connection_request_sent_at, dm_connection_accepted_at, dm_first_message_sent_at, dm_replied_at, last_attio_status')
    .gte('created_at', cutoff);

  if (!leads?.length) return;

  type SegKey = { type: string; value: string };
  const buckets: Map<string, { type: string; value: string; leads: any[] }> = new Map();

  for (const lead of leads) {
    const segments: SegKey[] = [
      { type: 'role_function',    value: lead.role_function ?? 'unknown' },
      { type: 'cohort_label',     value: lead.cohort_label ?? 'unknown' },
      { type: 'industry',         value: lead.linkedin_company_industry ?? 'unknown' },
      { type: 'fit_score_band',   value: fitBand(lead.fit_score) },
      { type: 'company_size_band', value: sizeBand(lead.linkedin_company_employees_count) },
    ];
    for (const seg of segments) {
      const key = `${seg.type}::${seg.value}`;
      if (!buckets.has(key)) buckets.set(key, { type: seg.type, value: seg.value, leads: [] });
      buckets.get(key)!.leads.push(lead);
    }
  }

  const rows: any[] = [];
  for (const [, bucket] of buckets) {
    const ll = bucket.leads;
    const sent      = ll.filter(l => l.dm_connection_request_sent_at).length;
    const accepted  = ll.filter(l => l.dm_connection_accepted_at).length;
    const replied   = ll.filter(l => l.dm_replied_at).length;
    const accept_rate = sent > 0 ? accepted / sent : null;
    const reply_rate  = sent > 0 ? replied / sent : null;
    const avg_fit = ll.reduce((s, l) => s + (l.fit_score ?? 0), 0) / ll.length;

    // Anomaly detection: compare to global baseline
    const global_accept_baseline = 0.10; // current known baseline ~6%, set target at 10%
    const is_under = accept_rate !== null && sent >= MIN_SENDS_FOR_STATS && accept_rate < global_accept_baseline * 0.5;
    const is_over  = accept_rate !== null && sent >= MIN_SENDS_FOR_STATS && accept_rate > global_accept_baseline * 2;

    rows.push({
      segment_type:      bucket.type,
      segment_value:     bucket.value,
      window_days:       WINDOW_DAYS,
      total_leads:       ll.length,
      sent,
      accepted,
      replied,
      positive_replied:  replied, // proxy until we have reply classification
      accept_rate,
      reply_rate,
      avg_fit_score:     Math.round(avg_fit),
      is_underperforming: is_under,
      is_overperforming:  is_over,
      anomaly_note: is_under
        ? `Accept rate ${((accept_rate ?? 0)*100).toFixed(1)}% is >50% below baseline on ${sent} sends`
        : is_over
        ? `Accept rate ${((accept_rate ?? 0)*100).toFixed(1)}% is >2x baseline on ${sent} sends — expand`
        : null,
    });
  }

  if (rows.length) {
    const { error } = await supa.from('outbound_segment_stats').insert(rows);
    if (error) console.error('[ml] clustering insert error:', JSON.stringify(error));
  }

  console.log(`[ml] clustering: ${rows.length} segments computed`);
  return rows.filter(r => r.is_underperforming || r.is_overperforming);
}

// ================================================================
// LAYER 3A: A/B STATISTICAL ANALYSIS
// Z-test for proportions: variant accept_rate vs control accept_rate
// ================================================================
async function runABAnalysis() {
  const { data: variants } = await supa
    .from('outbound_ab_variants')
    .select('*')
    .eq('is_active', true);

  if (!variants?.length) return;

  const control = variants.find(v => v.is_control);
  if (!control) return;

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Pull event data keyed by variant_id from outbound_events
  const { data: events } = await supa
    .from('outbound_events')
    .select('lead_id, event_type, properties')
    .in('event_type', ['connection_sent', 'connection_accepted', 'reply_received', 'message_sent'])
    .gte('occurred_at', cutoff);

  // Group by variant_id in properties
  const byVariant: Map<string, { sent: number; accepted: number; replied: number }> = new Map();

  for (const evt of (events ?? [])) {
    const vid = evt.properties?.variant_id ?? control.variant_key;
    if (!byVariant.has(vid)) byVariant.set(vid, { sent: 0, accepted: 0, replied: 0 });
    const b = byVariant.get(vid)!;
    if (evt.event_type === 'connection_sent') b.sent++;
    if (evt.event_type === 'connection_accepted') b.accepted++;
    if (evt.event_type === 'reply_received') b.replied++;
  }

  const controlStats = byVariant.get(control.variant_key) ?? { sent: 0, accepted: 0, replied: 0 };
  const controlRate  = controlStats.sent > 0 ? controlStats.accepted / controlStats.sent : 0;

  const results: any[] = [];
  for (const variant of variants) {
    const stats = byVariant.get(variant.variant_key) ?? { sent: 0, accepted: 0, replied: 0 };
    const accept_rate = stats.sent > 0 ? stats.accepted / stats.sent : null;
    const reply_rate  = stats.sent > 0 ? stats.replied / stats.sent : null;

    let z_score: number | null = null;
    let p_value: number | null = null;
    let is_significant = false;

    if (!variant.is_control && stats.sent >= MIN_SENDS_FOR_SIGNIFICANCE && controlStats.sent >= MIN_SENDS_FOR_SIGNIFICANCE) {
      // Two-proportion z-test
      const p1 = accept_rate ?? 0;
      const p2 = controlRate;
      const n1 = stats.sent;
      const n2 = controlStats.sent;
      const p_pool = (stats.accepted + controlStats.accepted) / (n1 + n2);
      const se = Math.sqrt(p_pool * (1 - p_pool) * (1/n1 + 1/n2));
      z_score = se > 0 ? (p1 - p2) / se : 0;
      // Approximate p-value from z (two-tailed, normal approximation)
      p_value = 2 * (1 - normalCDF(Math.abs(z_score)));
      is_significant = p_value < 0.05;
    }

    let recommendation = 'insufficient_data';
    if (stats.sent >= MIN_SENDS_FOR_SIGNIFICANCE) {
      if (variant.is_control) {
        recommendation = 'continue_testing';
      } else if (is_significant && (accept_rate ?? 0) > controlRate) {
        recommendation = 'promote';
      } else if (is_significant && (accept_rate ?? 0) < controlRate) {
        recommendation = 'pause';
      } else {
        recommendation = 'continue_testing';
      }
    }

    results.push({
      variant_id:           variant.id,
      window_days:          WINDOW_DAYS,
      sends:                stats.sent,
      accepts:              stats.accepted,
      replies:              stats.replied,
      positive_replies:     stats.replied,
      accept_rate,
      reply_rate,
      positive_reply_rate:  reply_rate,
      z_score,
      p_value,
      is_significant,
      recommendation,
    });
  }

  if (results.length) {
    const { error } = await supa.from('outbound_ab_results').insert(results);
    if (error) console.error('[ml] ab_results insert error:', JSON.stringify(error));
  }

  console.log(`[ml] A/B analysis: ${results.length} variants computed`);
  return results;
}

// ================================================================
// LAYER 3B: VARIANT PROMOTION — auto-promote winning variants
// ================================================================
async function runVariantPromotion(abResults: any[]) {
  if (!abResults?.length) return;

  const toPromote = abResults.filter(r => r.recommendation === 'promote' && r.is_significant);
  const toPause   = abResults.filter(r => r.recommendation === 'pause'   && r.is_significant);

  for (const r of toPromote) {
    // Retire current control, make winner the new control
    await supa.from('outbound_ab_variants')
      .update({ is_control: false, traffic_weight: 0.2 })
      .eq('is_control', true);
    await supa.from('outbound_ab_variants')
      .update({ is_control: true, traffic_weight: 1.0 })
      .eq('id', r.variant_id);
    // Log to optimizer_decisions
    await supa.from('optimizer_decisions').insert({
      mode: 'live',
      stage: 'ab_test',
      metric_name: 'variant_accept_rate',
      metric_value: r.accept_rate,
      sample_size: r.sends,
      parameter_changed: 'default_opener_template',
      reasoning: `Variant promoted: accept_rate ${(r.accept_rate*100).toFixed(1)}% vs control, z=${r.z_score?.toFixed(2)}, p=${r.p_value?.toFixed(3)}, n=${r.sends}`,
      reversal_trigger: 'accept_rate drops below control baseline for 7 days',
      executed: true,
    });
    console.log(`[ml] promoted variant ${r.variant_id}`);
  }

  for (const r of toPause) {
    await supa.from('outbound_ab_variants')
      .update({ is_active: false, retired_at: new Date().toISOString(), retire_reason: `Underperformed control: p=${r.p_value?.toFixed(3)}, n=${r.sends}` })
      .eq('id', r.variant_id);
    console.log(`[ml] paused variant ${r.variant_id}`);
  }
}

// ================================================================
// LAYER 3C: RL REWARD SIGNAL
// Objective: maximize positive_reply_rate, constraint: unsubscribe_rate < 0.02
// Reward = reply_rate_delta - 10 * unsubscribe_penalty
// ================================================================
async function computeRLReward() {
  // Get last two RL states to compute delta
  const { data: prev_states } = await supa
    .from('outbound_rl_state')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(2);

  // Current system metrics
  const { data: current } = await supa
    .from('optimizer_funnel_snapshots')
    .select('accept_rate, reply_rate, leads_ingested, dms_sent')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: config_thresh } = await supa.from('optimizer_config').select('value').eq('key', 'fit_score_threshold').maybeSingle();
  const { data: config_budget } = await supa.from('optimizer_config').select('value').eq('key', 'daily_dm_budget').maybeSingle();
  const { data: active_variant } = await supa.from('outbound_ab_variants').select('variant_key').eq('is_control', true).eq('is_active', true).maybeSingle();

  const accept_rate = current?.accept_rate ? Number(current.accept_rate) : 0;
  const reply_rate  = current?.reply_rate  ? Number(current.reply_rate)  : 0;

  // Reward components
  const prev = prev_states?.[0];
  const prev_reply = prev?.outcome_reply_rate ?? 0;
  const reply_delta = reply_rate - prev_reply;

  // Unsubscribe proxy: bounces / sends (we don't have explicit unsubscribes yet)
  const { count: bounce_count } = await supa
    .from('warm_outbound_staging')
    .select('id', { count: 'exact', head: true })
    .eq('delivery_status', 'bounce')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  const { count: send_count } = await supa
    .from('warm_outbound_staging')
    .select('id', { count: 'exact', head: true })
    .not('delivery_status', 'is', null)
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  const bounce_rate = send_count && send_count > 0 ? (bounce_count ?? 0) / send_count : 0;
  const unsubscribe_penalty = bounce_rate > UNSUBSCRIBE_CEILING ? (bounce_rate - UNSUBSCRIBE_CEILING) * 10 : 0;

  // Reward signal: positive = improving, negative = degrading
  const reward_signal = reply_delta - unsubscribe_penalty + (accept_rate * 0.3);

  // Fill in outcome on previous state
  if (prev?.id) {
    await supa.from('outbound_rl_state')
      .update({
        outcome_measured_at: new Date().toISOString(),
        outcome_accept_rate: accept_rate,
        outcome_reply_rate:  reply_rate,
      })
      .eq('id', prev.id);
  }

  // Record new state
  const { error } = await supa.from('outbound_rl_state').insert({
    objective_primary:    'maximize_positive_reply_rate',
    objective_constraint: 'unsubscribe_rate < 0.02',
    fit_score_threshold:  config_thresh?.value ?? 70,
    daily_dm_budget:      config_budget?.value ?? 10,
    active_variant_key:   active_variant?.variant_key ?? 'opener_inspector_question_v1',
    active_cohorts:       [],
    reward_signal,
    reward_components: {
      reply_rate_delta:      reply_delta,
      current_accept_rate:  accept_rate,
      bounce_rate,
      unsubscribe_penalty,
    },
    action_taken: prev_states?.[0]?.action_taken ?? 'initial_state',
  });

  if (error) console.error('[ml] rl_state insert error:', JSON.stringify(error));
  console.log(`[ml] RL reward signal: ${reward_signal.toFixed(4)} (reply_delta=${reply_delta.toFixed(4)}, bounce_rate=${bounce_rate.toFixed(4)})`);
  return { reward_signal, accept_rate, reply_rate, bounce_rate };
}

// ================================================================
// LAYER 3D: VARIANT ASSIGNMENT
// Writes active variant key to optimizer_config so first-touch-drafter
// can read it and inject the right opener template
// ================================================================
async function updateVariantAssignment() {
  const { data: variants } = await supa
    .from('outbound_ab_variants')
    .select('variant_key, traffic_weight')
    .eq('is_active', true);

  if (!variants?.length) return;

  // Weighted random selection for next batch
  const totalWeight = variants.reduce((s, v) => s + Number(v.traffic_weight), 0);
  let rand = Math.random() * totalWeight;
  let selected = variants[0];
  for (const v of variants) {
    rand -= Number(v.traffic_weight);
    if (rand <= 0) { selected = v; break; }
  }

  await supa.from('optimizer_config').upsert({
    key: 'next_batch_variant',
    value: JSON.stringify(selected.variant_key),
    reasoning: `Weighted random selection from ${variants.length} active variants`,
    updated_at: new Date().toISOString(),
    updated_by: 'outbound-ml-analyzer',
  });

  console.log(`[ml] next batch variant: ${selected.variant_key}`);
  return selected.variant_key;
}

// ================================================================
// HELPERS
// ================================================================
function fitBand(score: number | null): string {
  if (!score) return 'unscored';
  if (score >= 90) return '90-100';
  if (score >= 80) return '80-89';
  if (score >= 70) return '70-79';
  if (score >= 60) return '60-69';
  return 'below-60';
}

function sizeBand(size: number | null): string {
  if (!size) return 'unknown';
  if (size <= 50)   return '1-50';
  if (size <= 200)  return '51-200';
  if (size <= 500)  return '201-500';
  if (size <= 1000) return '501-1000';
  if (size <= 5000) return '1001-5000';
  return '5000+';
}

// Normal CDF approximation (Abramowitz and Stegun)
function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const pdf  = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const cdf  = 1 - pdf * poly;
  return z >= 0 ? cdf : 1 - cdf;
}

// ================================================================
// ENTRY
// ================================================================
Deno.serve(async (_req) => {
  try {
    await backfillSensorEvents();
    const [anomalies, abResults, rlReward, nextVariant] = await Promise.all([
      runClustering(),
      runABAnalysis(),
      computeRLReward(),
      updateVariantAssignment(),
    ]);
    await runVariantPromotion(abResults ?? []);

    return new Response(JSON.stringify({
      ok: true,
      clustering_anomalies: anomalies?.length ?? 0,
      ab_variants_analyzed: abResults?.length ?? 0,
      rl_reward_signal:     rlReward?.reward_signal ?? null,
      next_batch_variant:   nextVariant ?? null,
    }, null, 2), { headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error('[ml] fatal error:', e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
