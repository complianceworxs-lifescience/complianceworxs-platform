// outbound-health-audit v6 — May 20 2026
// Fix v5: read total Gmail sends from gmail_send_log (first-touch + followup),
// not just dispatched_at (which only tracks first-touch).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface Finding {
  alert_type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  context: Record<string, unknown>;
  healed?: boolean;
  heal_action?: string;
}

async function invokeEdgeFunction(name: string): Promise<{ ok: boolean; status?: number; body?: any; error?: string }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
      body: '{}',
      signal: AbortSignal.timeout(180000),
    });
    const txt = await r.text();
    let body: any;
    try { body = JSON.parse(txt); } catch { body = txt.slice(0, 500); }
    return { ok: r.ok, status: r.status, body };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

async function getGmailSends24h(supabase: any): Promise<number> {
  // Total sends (first-touch + followup) from gmail_send_log
  const { count } = await supabase.from('gmail_send_log')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  return count ?? 0;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === '1';
  const skipHeal = url.searchParams.get('skip_heal') === '1';
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const findings: Finding[] = [];
  const checks: string[] = [];
  let throughputHealLog: any = null;

  // CHECK 1: Zero sends 24h via gmail_send_log (covers BOTH first-touch and followup)
  try {
    const sends24h = await getGmailSends24h(supabase);
    checks.push(`gmail_sends_24h=${sends24h}`);

    if (sends24h === 0 && !dryRun && !skipHeal) {
      const healLog: any = { steps: [], started_at: new Date().toISOString() };
      const fud = await invokeEdgeFunction('followup-drafter');
      healLog.steps.push({ step: 'followup-drafter', ok: fud.ok, summary: fud.body?.summary || fud.error });
      const fudp = await invokeEdgeFunction('followup-dispatcher');
      healLog.steps.push({ step: 'followup-dispatcher', ok: fudp.ok, summary: fudp.body?.summary || fudp.error });
      const ftd = await invokeEdgeFunction('first-touch-drafter');
      healLog.steps.push({ step: 'first-touch-drafter', ok: ftd.ok, summary: `drafted=${ftd.body?.drafted || 0}` });
      const ots = await invokeEdgeFunction('outbound-sender-gmail');
      healLog.steps.push({ step: 'outbound-sender-gmail', ok: ots.ok, summary: ots.body?.summary || ots.error });

      const sendsAfter = await getGmailSends24h(supabase);
      healLog.sends_24h_before = sends24h;
      healLog.sends_24h_after = sendsAfter;
      healLog.healed = sendsAfter > 0;
      throughputHealLog = healLog;

      if (sendsAfter > 0) {
        findings.push({
          alert_type: 'zero_sends_24h',
          severity: 'warning',
          message: `Pipeline was dark — auto-healed. Sent ${sendsAfter} in last 24h after drafter+dispatcher chain.`,
          context: { sends_24h_before: 0, sends_24h_after: sendsAfter, heal_log: healLog },
          healed: true,
          heal_action: `Ran drafter+dispatcher chain. Recovered ${sendsAfter} sends.`,
        });
      } else {
        findings.push({
          alert_type: 'zero_sends_24h',
          severity: 'critical',
          message: `Pipeline dark. Auto-heal ran drafter+dispatcher chain but produced zero sends. Manual investigation required.`,
          context: { sends_24h: 0, heal_log: healLog },
          healed: false,
        });
      }
    } else if (sends24h === 0) {
      findings.push({
        alert_type: 'zero_sends_24h', severity: 'critical',
        message: 'Zero outbound sends in last 24 hours. Pipeline is dark.',
        context: { sends_24h: 0 },
      });
    }
  } catch (e: any) { findings.push({ alert_type: 'audit_check_failed', severity: 'warning', message: `sends: ${e.message}`, context: {} }); }

  // CHECK 2: Drafter eligible backlog
  try {
    const { count } = await supabase.from('warm_outbound_staging')
      .select('id', { count: 'exact', head: true })
      .gte('fit_score', 80).is('first_touch_drafted_at', null)
      .is('archived_at', null).is('replied_at', null)
      .is('delivery_status', null).is('dispatched_at', null)
      .not('email', 'is', null).neq('automation_paused', true);
    const n = count ?? 0;
    checks.push(`drafter_eligible=${n}`);
    if (n >= 5) {
      findings.push({
        alert_type: 'drafter_eligible_backlog', severity: 'warning',
        message: `${n} leads at fit_score>=80 ready for first-touch drafting but not picked up.`,
        context: { eligible_count: n },
      });
    }
  } catch (e: any) { findings.push({ alert_type: 'audit_check_failed', severity: 'warning', message: `drafter: ${e.message}`, context: {} }); }

  // CHECK 3: PB slot exhaustion
  try {
    const { count } = await supabase.from('warm_outbound_staging')
      .select('id', { count: 'exact', head: true })
      .ilike('dm_status', '%Agent maximum parallel%');
    const n = count ?? 0;
    checks.push(`pb_slot_failures=${n}`);
    if (n >= 3) {
      let healed = false; let healAction = '';
      if (!dryRun) {
        const { error: e } = await supabase.from('warm_outbound_staging')
          .update({ dm_status: 'pending_manual_dm', review_status: 'needs_manual_dm', dm_phantombuster_container_id: null })
          .ilike('dm_status', '%Agent maximum parallel%');
        if (!e) { healed = true; healAction = `Routed ${n} PB slot-failed leads to pending_manual_dm.`; }
      }
      findings.push({
        alert_type: 'phantombuster_slot_exhaustion', severity: 'critical',
        message: `${n} DM dispatches failed (PB slot). ${healed ? 'AUTO-HEALED.' : ''}`,
        context: { fail_count: n, healed, heal_action: healAction },
        healed, heal_action: healAction,
      });
    }
  } catch (e: any) { findings.push({ alert_type: 'audit_check_failed', severity: 'warning', message: `pb: ${e.message}`, context: {} }); }

  // CHECK 4: DM ready_to_dispatch
  try {
    const { count } = await supabase.from('warm_outbound_staging')
      .select('id', { count: 'exact', head: true })
      .eq('dm_status', 'ready_to_dispatch');
    const n = count ?? 0;
    checks.push(`dm_ready_stale=${n}`);
    if (n >= 1) {
      let healed = false; let healAction = '';
      if (!dryRun) {
        const { error: e } = await supabase.from('warm_outbound_staging')
          .update({ dm_status: 'pending_manual_dm', review_status: 'needs_manual_dm' })
          .eq('dm_status', 'ready_to_dispatch');
        if (!e) { healed = true; healAction = `Routed ${n} to pending_manual_dm.`; }
      }
      findings.push({
        alert_type: 'dm_dispatch_queue_stale', severity: 'warning',
        message: `${n} DMs in ready_to_dispatch. ${healed ? 'AUTO-HEALED.' : ''}`,
        context: { stale_count: n, healed, heal_action: healAction },
        healed, heal_action: healAction,
      });
    }
  } catch (e: any) { findings.push({ alert_type: 'audit_check_failed', severity: 'warning', message: `dm rtd: ${e.message}`, context: {} }); }

  // CHECK 5: Intake collapse
  try {
    const { count } = await supabase.from('warm_outbound_staging')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());
    const n = count ?? 0;
    checks.push(`intake_48h=${n}`);
    if (n < 5) {
      findings.push({
        alert_type: 'intake_collapse', severity: 'warning',
        message: `Only ${n} new leads in last 48h. Check PhantomBuster phantom 8310315885703243.`,
        context: { intake_48h: n },
      });
    }
  } catch (e: any) { findings.push({ alert_type: 'audit_check_failed', severity: 'warning', message: `intake: ${e.message}`, context: {} }); }

  // CHECK 6: Stage/touch mismatch + auto-heal
  try {
    const { data: mismatch } = await supabase.rpc('count_stage_touch_mismatch');
    const n = (mismatch as any) ?? 0;
    checks.push(`stage_touch_mismatch=${n}`);
    if (n > 0) {
      let healed = false; let healAction = '';
      if (!dryRun) {
        const { data, error: e } = await supabase.rpc('fix_stage_touch_mismatch');
        if (!e) { healed = true; healAction = `Advanced ${data || n} leads to correct followup_stage.`; }
      }
      findings.push({
        alert_type: 'stage_touch_mismatch', severity: 'warning',
        message: `${n} leads with stage/touch off-by-one. ${healed ? 'AUTO-HEALED.' : ''}`,
        context: { mismatch_count: n, healed, heal_action: healAction },
        healed, heal_action: healAction,
      });
    }
  } catch (e: any) {
    if (!e.message?.includes('does not exist')) {
      findings.push({ alert_type: 'audit_check_failed', severity: 'warning', message: `stage: ${e.message}`, context: {} });
    }
  }

  // CHECK 7: False followup_completed_at
  try {
    const { count } = await supabase.from('warm_outbound_staging')
      .select('id', { count: 'exact', head: true })
      .not('followup_completed_at', 'is', null)
      .in('followup_stage', ['followup_1_due','followup_2_due','followup_3_due','followup_4_due','followup_5_due','followup_6_due','followup_7_due','breakup_due'])
      .is('replied_at', null).is('archived_at', null).neq('automation_paused', true);
    const n = count ?? 0;
    checks.push(`false_completed=${n}`);
    if (n > 0) {
      let healed = false; let healAction = '';
      if (!dryRun) {
        const { error: e } = await supabase.from('warm_outbound_staging')
          .update({ followup_completed_at: null })
          .not('followup_completed_at', 'is', null)
          .in('followup_stage', ['followup_1_due','followup_2_due','followup_3_due','followup_4_due','followup_5_due','followup_6_due','followup_7_due','breakup_due'])
          .is('replied_at', null).is('archived_at', null).neq('automation_paused', true);
        if (!e) { healed = true; healAction = `Cleared followup_completed_at on ${n} mid-sequence leads.`; }
      }
      findings.push({
        alert_type: 'false_followup_completed', severity: 'warning',
        message: `${n} leads falsely marked followup_completed. Blocks dispatcher. ${healed ? 'AUTO-HEALED.' : ''}`,
        context: { false_completed_count: n, healed, heal_action: healAction },
        healed, heal_action: healAction,
      });
    }
  } catch (e: any) { findings.push({ alert_type: 'audit_check_failed', severity: 'warning', message: `false completed: ${e.message}`, context: {} }); }

  // CHECK 8: Edge function failures
  try {
    const { data: failures, error } = await supabase.rpc('audit_recent_function_failures', { p_hours: 24 });
    if (error && !error.message?.includes('does not exist')) throw error;
    const fails = (failures || []) as any[];
    checks.push(`edge_failures_24h=${fails.length}`);
    // Only alert if > 5 (ambient pg_net 5s timeouts on attio drainers are noise)
    if (fails.length > 5) {
      findings.push({
        alert_type: 'edge_function_non_200_responses', severity: 'critical',
        message: `${fails.length} edge function calls failed in 24h.`,
        context: { failures: fails.slice(0, 5) },
      });
    }
  } catch (e: any) { findings.push({ alert_type: 'audit_check_failed', severity: 'warning', message: `edge: ${e.message}`, context: {} }); }

  // CHECK 9: Unactioned replies
  try {
    const { count } = await supabase.from('warm_outbound_staging')
      .select('id', { count: 'exact', head: true })
      .not('replied_at', 'is', null).is('automation_paused', false)
      .gt('replied_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    const n = count ?? 0;
    checks.push(`unactioned_replies=${n}`);
    if (n >= 1) {
      findings.push({
        alert_type: 'unactioned_replies', severity: 'warning',
        message: `${n} email replies in last 7d not actioned (automation still active).`,
        context: { reply_count: n },
      });
    }
  } catch (e: any) { findings.push({ alert_type: 'audit_check_failed', severity: 'warning', message: `replies: ${e.message}`, context: {} }); }

  // CHECK 10: Cron failures
  try {
    const { data: cronFails, error } = await supabase.rpc('audit_recent_cron_failures', { p_hours: 24 });
    if (error && !error.message?.includes('does not exist')) throw error;
    const fails = (cronFails || []) as any[];
    checks.push(`cron_failures_24h=${fails.length}`);
    if (fails.length > 0) {
      findings.push({
        alert_type: 'cron_job_failure', severity: 'critical',
        message: `${fails.length} cron jobs failed in 24h.`,
        context: { failures: fails.slice(0, 10) },
      });
    }
  } catch (e: any) { findings.push({ alert_type: 'audit_check_failed', severity: 'warning', message: `cron: ${e.message}`, context: {} }); }

  // Persist
  if (!dryRun) {
    const fired = new Set(findings.map(f => f.alert_type));
    for (const f of findings) {
      const { data: existing } = await supabase.from('system_alerts')
        .select('id').eq('alert_type', f.alert_type).is('resolved_at', null)
        .eq('source', 'outbound-health-audit-v2').maybeSingle();
      if (!existing) {
        await supabase.from('system_alerts').insert({
          alert_type: f.alert_type, severity: f.severity, message: f.message,
          context: f.context, source: 'outbound-health-audit-v2',
        });
      } else {
        await supabase.from('system_alerts')
          .update({ message: f.message, context: f.context, severity: f.severity })
          .eq('id', existing.id);
      }
    }
    const types = ['zero_sends_24h','drafter_eligible_backlog','phantombuster_slot_exhaustion',
      'dm_dispatch_queue_stale','intake_collapse','edge_function_non_200_responses',
      'unactioned_replies','cron_job_failure','stage_touch_mismatch','false_followup_completed'];
    const toResolve = types.filter(t => !fired.has(t));
    if (toResolve.length > 0) {
      await supabase.from('system_alerts')
        .update({ resolved_at: new Date().toISOString() })
        .in('alert_type', toResolve).eq('source', 'outbound-health-audit-v2').is('resolved_at', null);
    }
  }

  return new Response(JSON.stringify({
    ok: true, dry_run: dryRun, skip_heal: skipHeal, timestamp: new Date().toISOString(),
    findings_count: findings.length,
    critical_count: findings.filter(f => f.severity === 'critical').length,
    healed_count: findings.filter(f => f.healed).length,
    checks_run: checks,
    throughput_heal_log: throughputHealLog,
    findings,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
