// dm-dispatcher v8
// ARCHITECTURE: Push model. Reads from v_queue_dm_dispatch and v_queue_warm_dm.
// These views encode all eligibility logic in SQL. This function does zero state scanning.
// SELECT 1 row from view → execute → write back → row vanishes from view. Done.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PB_API_KEY = Deno.env.get('PHANTOMBUSTER_API_KEY') ?? '';
const PB_AUTO_CONNECT_AGENT = '5944820811686642';
const MAX_NOTE_CHARS = 295;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function buildNote(lead: any): string {
  const dm = (lead.dm_draft_body || '').trim();
  if (dm) return dm.slice(0, MAX_NOTE_CHARS).trimEnd();
  const body = (lead.first_touch_draft_body || '').trim();
  if (!body) return '';
  return body.split(/\n\n/)[0].replace(/\n/g, ' ').trim().slice(0, MAX_NOTE_CHARS).trimEnd();
}

async function getDailyBudget(supabase: any): Promise<number> {
  const { data } = await supabase.from('optimizer_config').select('value').eq('key', 'daily_dm_budget').maybeSingle();
  return (data?.value as number) ?? 10;
}

async function getSentTodayCount(supabase: any): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase.from('warm_outbound_staging').select('id', { count: 'exact', head: true }).gte('dm_connection_request_sent_at', todayStart.toISOString());
  return count ?? 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const dryRun = new URL(req.url).searchParams.get('dry_run') === '1';

  const dailyBudget = await getDailyBudget(supabase);
  const sentToday = await getSentTodayCount(supabase);
  const remaining = Math.max(0, dailyBudget - sentToday);

  const results: any[] = [];
  let warmQueued = 0;
  let coldSent = 0;
  let coldSkipped = 0;

  // ── WARM PATH: pull all from v_queue_warm_dm, mark warm_queued (no PB needed) ──
  const { data: warmLeads } = await supabase.from('v_queue_warm_dm').select('id, full_name, company, fit_score');
  for (const lead of (warmLeads || [])) {
    if (!dryRun) {
      await supabase.from('warm_outbound_staging').update({
        outbound_action: 'warm_1st_degree_queued',
        // dm_status already 'warm_queued' — no change needed, view confirms it
      }).eq('id', lead.id);
    }
    warmQueued++;
    results.push({ id: lead.id, name: lead.full_name, company: lead.company, fit: lead.fit_score, route: 'warm_1st_degree', action: dryRun ? 'dry_run' : 'confirmed_warm_queued' });
  }

  // ── COLD PATH: pull TOP 1 from v_queue_dm_dispatch, fire PB ──
  if (remaining > 0 && PB_API_KEY) {
    const { data: coldQueue } = await supabase.from('v_queue_dm_dispatch').select('*').limit(1);
    const lead = coldQueue?.[0];

    if (lead) {
      const note = buildNote(lead);
      if (!dryRun) {
        let launched = false;
        let containerId: string | null = null;
        let errDetail: string | null = null;

        try {
          const r = await fetch('https://api.phantombuster.com/api/v2/agents/launch', {
            method: 'POST',
            headers: { 'X-Phantombuster-Key': PB_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: PB_AUTO_CONNECT_AGENT, bonusArgument: { profileUrl: lead.linkedin_url, message: note, numberOfAddsPerLaunch: 1 } }),
            signal: AbortSignal.timeout(15000),
          });
          const text = await r.text();
          let json: any = {};
          try { json = JSON.parse(text); } catch {}

          if (r.ok) {
            containerId = json?.containerId || json?.data?.containerId || null;
            launched = true;
            await supabase.from('warm_outbound_staging').update({
              dm_status: 'connect_request_queued',
              dm_connection_request_sent_at: new Date().toISOString(),
              dispatched_at: new Date().toISOString(),
              phantombuster_container_id: containerId,
              outbound_action: 'pb_connect_request_sent',
            }).eq('id', lead.id);
            coldSent++;
          } else if (text.includes('maxParallelismReached') || r.status === 429) {
            errDetail = 'pb_agent_busy';
            coldSkipped++;
          } else if (text.includes('Agent not found') || r.status === 404) {
            await supabase.from('warm_outbound_staging').update({ outbound_action: 'pb_agent_dead' }).eq('id', lead.id);
            errDetail = 'pb_agent_dead';
            coldSkipped++;
          } else {
            await supabase.from('warm_outbound_staging').update({ outbound_action: `pb_launch_error_${r.status}` }).eq('id', lead.id);
            errDetail = `pb_${r.status}`;
            coldSkipped++;
          }
        } catch (e) {
          await supabase.from('warm_outbound_staging').update({ outbound_action: 'pb_exception' }).eq('id', lead.id);
          errDetail = (e as Error).message;
          coldSkipped++;
        }

        results.push({ id: lead.id, name: lead.full_name, company: lead.company, fit: lead.fit_score, route: 'cold_connect_request', action: launched ? 'sent' : 'skipped', containerId, note_length: note.length, error: errDetail });
      } else {
        coldSent++;
        results.push({ id: lead.id, name: lead.full_name, company: lead.company, fit: lead.fit_score, route: 'cold_connect_request', action: 'dry_run', note_length: note.length, note_preview: note.slice(0, 80) });
      }
    }
  }

  return new Response(JSON.stringify({
    ok: true, dry_run: dryRun, architecture: 'push_model_v8',
    daily_budget: dailyBudget, sent_today: sentToday, remaining_budget: remaining,
    dispatched: { warm_1st_degree: warmQueued, cold_sent: coldSent, cold_skipped: coldSkipped },
    results,
  }, null, 2), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
