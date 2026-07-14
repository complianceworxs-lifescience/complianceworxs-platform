// pipeline-watchdog v5
// FIX: drafted_never_dispatched check now filters send_message_id IS NULL.
// Previously all 65 'stuck' leads were email-outreach leads (send_message_id set),
// generating a permanent false-positive critical alert.
// The check now correctly counts only leads where no outreach channel has worked them.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PB_API_KEY = Deno.env.get('PHANTOMBUSTER_API_KEY') ?? '';
const PB_AUTO_CONNECT_AGENT = '5944820811686642';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const CRITICAL_CRONS = [
  { name: 'lead-fit-scorer-15min',               max_silence_minutes: 30 },
  { name: 'prospeo-linkedin-enrich-15min',        max_silence_minutes: 30 },
  { name: 'first-touch-drafter-daily-645am-edt', max_silence_minutes: 48 * 60 },
  { name: 'dm-dispatcher-weekday-915am-edt',     max_silence_minutes: 48 * 60 },
  { name: 'outbound-sender-gmail-daily-7am-edt', max_silence_minutes: 48 * 60 },
  { name: 'followup-drafter-daily-6am-edt',      max_silence_minutes: 48 * 60 },
];

const PB_TRANSIENT = ['pb_agent_busy_retry_tomorrow', 'pb_exception', 'pb_timeout_reset_retryable'];
const PB_ERROR_PATTERN = /^pb_launch_error_(\d+)$/;

interface HealthResult {
  check_name: string;
  severity: 'critical' | 'warning' | 'info';
  affected_count: number;
  status: 'healthy' | 'degraded' | 'remediated' | 'manual_required';
  detail: Record<string, any>;
  remediated_count?: number;
}

async function fixPBFailures(supabase: any): Promise<HealthResult> {
  const { data: pbFailed } = await supabase
    .from('warm_outbound_staging')
    .select('id, full_name, company, outbound_action, dm_status, dm_connection_request_sent_at, linkedin_url, dm_draft_body, first_touch_draft_body')
    .not('outbound_action', 'is', null)
    .ilike('outbound_action', 'pb_%')
    .is('archived_at', null);

  const rows = (pbFailed || []).filter((r: any) => r.outbound_action !== 'pb_connect_request_sent');
  if (rows.length === 0) {
    return { check_name: 'phantombuster_failures', severity: 'info', affected_count: 0, status: 'healthy', detail: { message: 'No PB failure flags' } };
  }

  const toClear: number[] = [];
  const toResetAndClear: number[] = [];
  const toRelaunch: any[] = [];
  const cantFix: any[] = [];

  for (const row of rows) {
    const action = row.outbound_action || '';
    if (action === 'pb_key_missing_manual_required') { cantFix.push(row); continue; }
    if (action === 'pb_agent_dead') { toRelaunch.push(row); continue; }
    if (PB_TRANSIENT.includes(action) || PB_ERROR_PATTERN.test(action)) {
      if (row.dm_connection_request_sent_at && row.dm_status === 'connect_request_queued') {
        toResetAndClear.push(row.id);
      } else {
        toClear.push(row.id);
      }
    }
  }

  let remediated = 0;
  const detail: Record<string, any> = {};

  if (toClear.length > 0) {
    const { data: cleared } = await supabase.from('warm_outbound_staging').update({ outbound_action: null }).in('id', toClear).select('id');
    remediated += cleared?.length ?? 0;
    detail.cleared_transient = toClear.length;
  }

  if (toResetAndClear.length > 0) {
    const { data: reset } = await supabase.from('warm_outbound_staging').update({ dm_status: null, dm_connection_request_sent_at: null, outbound_action: null }).in('id', toResetAndClear).select('id');
    remediated += reset?.length ?? 0;
    detail.reset_incorrectly_sent = toResetAndClear.length;
  }

  let relaunched = 0;
  if (toRelaunch.length > 0 && PB_API_KEY) {
    const lead = toRelaunch[0];
    const note = (lead.dm_draft_body || lead.first_touch_draft_body || '').slice(0, 295);
    try {
      const r = await fetch('https://api.phantombuster.com/api/v2/agents/launch', {
        method: 'POST',
        headers: { 'X-Phantombuster-Key': PB_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: PB_AUTO_CONNECT_AGENT, bonusArgument: { profileUrl: lead.linkedin_url, message: note, numberOfAddsPerLaunch: 1 } }),
        signal: AbortSignal.timeout(15000),
      });
      const respText = await r.text();
      let respJson: any = {};
      try { respJson = JSON.parse(respText); } catch {}
      if (r.ok) {
        await supabase.from('warm_outbound_staging').update({ dm_status: 'connect_request_queued', dm_connection_request_sent_at: new Date().toISOString(), dispatched_at: new Date().toISOString(), phantombuster_container_id: respJson?.containerId ?? null, outbound_action: 'pb_connect_request_sent' }).eq('id', lead.id);
        relaunched++; remediated++;
      } else if (respText.includes('maxParallelismReached')) {
        await supabase.from('warm_outbound_staging').update({ outbound_action: null }).eq('id', lead.id);
        relaunched++;
      } else {
        await supabase.from('warm_outbound_staging').update({ outbound_action: null }).eq('id', lead.id);
      }
    } catch { await supabase.from('warm_outbound_staging').update({ outbound_action: null }).eq('id', lead.id); }

    if (toRelaunch.length > 1) {
      const remainingIds = toRelaunch.slice(1).map((r: any) => r.id);
      await supabase.from('warm_outbound_staging').update({ outbound_action: null }).in('id', remainingIds);
      remediated += remainingIds.length;
    }
    detail.pb_agent_dead_handled = toRelaunch.length;
    detail.relaunched = relaunched;
  } else if (toRelaunch.length > 0) {
    const ids = toRelaunch.map((r: any) => r.id);
    await supabase.from('warm_outbound_staging').update({ outbound_action: null }).in('id', ids);
    remediated += ids.length;
  }

  detail.total_found = rows.length;
  return {
    check_name: 'phantombuster_failures',
    severity: cantFix.length > 0 ? 'warning' : 'info',
    affected_count: rows.length,
    status: remediated > 0 ? 'remediated' : 'healthy',
    detail,
    remediated_count: remediated,
  };
}

async function runChecks(supabase: any): Promise<HealthResult[]> {
  const results: HealthResult[] = [];
  const now = new Date();

  // CHECK 1: Drafted never dispatched via LinkedIn DM
  // FIX v5: Added send_message_id IS NULL — exclude leads already worked via Gmail.
  // All 65 previous 'stuck' leads were email-outreach leads. This was a permanent false-positive critical alert.
  const { data: stuckDrafts } = await supabase
    .from('warm_outbound_staging').select('id')
    .not('first_touch_draft_body', 'is', null)
    .is('dm_connection_request_sent_at', null)
    .is('archived_at', null)
    .is('send_message_id', null) // FIX: only leads not yet worked by any channel
    .eq('automation_paused', false)
    .eq('is_paying_customer', false)
    .not('linkedin_url', 'is', null)
    .or('dm_status.is.null,dm_status.not.in.(sent_manual,disqualified,warm_queued,connect_request_queued,sent_manual_backfilled)')
    .lt('first_touch_drafted_at', new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString());

  const stuckDraftCount = stuckDrafts?.length ?? 0;
  results.push({
    check_name: 'drafted_never_dispatched',
    severity: stuckDraftCount > 20 ? 'critical' : stuckDraftCount > 5 ? 'warning' : 'info',
    affected_count: stuckDraftCount,
    status: stuckDraftCount === 0 ? 'healthy' : 'degraded',
    detail: { fix: 'dm-dispatcher cron fires at 9:15 AM EDT weekdays', note: 'send_message_id=null ensures email-outreach leads excluded' },
  });

  // CHECK 2: Stuck enriching — auto-fix
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const { data: stuckEnriching } = await supabase
    .from('warm_outbound_staging').select('id')
    .eq('enrichment_status', 'enriching').is('enriched_at', null).is('archived_at', null)
    .lt('created_at', twoHoursAgo);
  const stuckIds = (stuckEnriching || []).map((r: any) => r.id);
  let enrichingRemediated = 0;
  if (stuckIds.length > 0) {
    const { data: fixed } = await supabase.from('warm_outbound_staging')
      .update({ enrichment_status: 'pending_enrichment', enriching_started_at: null })
      .in('id', stuckIds).select('id');
    enrichingRemediated = fixed?.length ?? 0;
  }
  results.push({ check_name: 'stuck_enriching', severity: stuckIds.length > 0 ? 'warning' : 'info', affected_count: stuckIds.length, status: stuckIds.length === 0 ? 'healthy' : 'remediated', detail: { ids_reset: stuckIds.slice(0, 20) }, remediated_count: enrichingRemediated });

  // CHECK 3: Accepted no follow-up >3 days
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: acceptedNoMsg } = await supabase
    .from('warm_outbound_staging')
    .select('id, full_name, company, dm_connection_accepted_at, linkedin_url')
    .not('dm_connection_accepted_at', 'is', null).is('dm_first_message_sent_at', null).is('archived_at', null)
    .lt('dm_connection_accepted_at', threeDaysAgo)
    .order('dm_connection_accepted_at', { ascending: true }).limit(50);
  results.push({
    check_name: 'accepted_no_followup',
    severity: (acceptedNoMsg?.length ?? 0) > 0 ? 'critical' : 'info',
    affected_count: acceptedNoMsg?.length ?? 0,
    status: (acceptedNoMsg?.length ?? 0) === 0 ? 'healthy' : 'manual_required',
    detail: { leads: (acceptedNoMsg || []).slice(0, 10).map((r: any) => ({ id: r.id, name: r.full_name, company: r.company, accepted: r.dm_connection_accepted_at, linkedin: r.linkedin_url })) },
  });

  // CHECK 4: Cron silence — 2x interval to avoid false positives on daily jobs
  for (const cron of CRITICAL_CRONS) {
    const { data: rawJob } = await supabase.from('cron.job').select('jobid, active').eq('jobname', cron.name).maybeSingle();
    let lastRan: string | null = null;
    if (rawJob?.jobid) {
      const { data: runRows } = await supabase
        .from('cron.job_run_details')
        .select('end_time')
        .eq('jobid', rawJob.jobid)
        .gte('start_time', new Date(now.getTime() - cron.max_silence_minutes * 60 * 1000).toISOString())
        .order('end_time', { ascending: false })
        .limit(1);
      lastRan = runRows?.[0]?.end_time ?? null;
    }
    const isSilent = !lastRan;
    results.push({
      check_name: `cron_silent_${cron.name}`,
      severity: isSilent && rawJob?.active ? 'warning' : 'info',
      affected_count: isSilent ? 1 : 0,
      status: isSilent ? 'degraded' : 'healthy',
      detail: { job_name: cron.name, last_ran: lastRan, silence_window_minutes: cron.max_silence_minutes, is_active: rawJob?.active },
    });
  }

  // CHECK 5: Scoring backlog
  const { count: unscoredCount } = await supabase
    .from('warm_outbound_staging').select('id', { count: 'exact', head: true })
    .is('fit_score', null).in('enrichment_status', ['enriched', 'pending_linkedin_dm'])
    .eq('automation_paused', false).eq('is_paying_customer', false).is('archived_at', null).not('full_name', 'is', null);
  results.push({ check_name: 'scoring_backlog', severity: (unscoredCount ?? 0) > 100 ? 'critical' : (unscoredCount ?? 0) > 30 ? 'warning' : 'info', affected_count: unscoredCount ?? 0, status: (unscoredCount ?? 0) === 0 ? 'healthy' : (unscoredCount ?? 0) > 30 ? 'degraded' : 'healthy', detail: {} });

  // CHECK 6: PB failures — auto-fix everything
  results.push(await fixPBFailures(supabase));

  return results;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const startTime = Date.now();
  let results: HealthResult[] = [];
  let insertError: string | null = null;
  try { results = await runChecks(supabase); } catch (e) { insertError = (e as Error).message; }
  if (results.length > 0) {
    const { error: ie } = await supabase.from('pipeline_health_log').insert(results.map(r => ({ check_name: r.check_name, severity: r.severity, affected_count: r.affected_count, status: r.status, detail: r.detail, remediated_at: r.remediated_count ? new Date().toISOString() : null, remediated_count: r.remediated_count ?? null })));
    if (ie) insertError = ie.message;
  }
  return new Response(JSON.stringify({ ok: !insertError, checked_at: new Date().toISOString(), total_checks: results.length, critical: results.filter(r => r.severity === 'critical').length, warning: results.filter(r => r.severity === 'warning').length, remediated: results.filter(r => r.status === 'remediated').length, total_ms: Date.now() - startTime, insert_error: insertError, results: results.map(r => ({ check: r.check_name, severity: r.severity, count: r.affected_count, status: r.status, remediated: r.remediated_count })) }, null, 2), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
