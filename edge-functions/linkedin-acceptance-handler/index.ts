// linkedin-acceptance-handler v3 - May 5 2026
// V3 ADDS: writes dm_connection_accepted_at to warm_outbound_staging when LinkedIn acceptance email arrives.
// Mirrors how gmail-reply-poller writes to inbound_replies. Acceptance state lives on the lead row now.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ATTIO_API_KEY = Deno.env.get("ATTIO_API_KEY")!;
const SECRET = Deno.env.get("PHANTOMBUSTER_WEBHOOK_SECRET")!;
const JON_WORKSPACE_MEMBER_ID = "b03c1e12-bfff-48e0-923d-c93953cbd103";

function parseLinkedInName(subject: string, body: string): string | null {
  const patterns = [
    /^(.+?)\s+accepted your (invitation|connection)/i,
    /^(.+?)\s+is now a connection/i,
    /^You and\s+(.+?)\s+are now connected/i,
    /(.+?)\s+has accepted/i,
  ];
  for (const p of patterns) {
    const m = subject.match(p);
    if (m && m[1]) return m[1].trim();
  }
  const bodyMatch = body.match(/^(.+?)\s+accepted your invitation/im);
  if (bodyMatch && bodyMatch[1]) return bodyMatch[1].trim();
  return null;
}

async function findPersonInAttio(name: string): Promise<any | null> {
  try {
    const res = await fetch("https://api.attio.com/v2/objects/people/records/query", {
      method: "POST",
      headers: { "Authorization": `Bearer ${ATTIO_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: { name: { full_name: { "$contains": name } } },
        limit: 5,
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const records: any[] = json?.data ?? [];
    if (records.length === 0) return null;
    const exact = records.find((r: any) =>
      r.values?.name?.[0]?.full_name?.toLowerCase() === name.toLowerCase()
    );
    return exact ?? records[0];
  } catch { return null; }
}

async function updateAttioRecord(recordId: string): Promise<boolean> {
  const note = `LinkedIn connection accepted ${new Date().toISOString().slice(0,10)} (auto-logged via Gmail forward).`;
  try {
    const res = await fetch(`https://api.attio.com/v2/objects/people/records/${recordId}`, {
      method: "PATCH",
      headers: { "Authorization": `Bearer ${ATTIO_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ data: { values: { temperature: "Hot", next_action: note } } }),
    });
    return res.ok;
  } catch { return false; }
}

async function createFollowupTask(recordId: string, leadName: string): Promise<boolean> {
  const deadline = new Date(Date.now() + 3 * 24 * 3600_000).toISOString();
  const content = `${leadName} - LinkedIn DM follow-up. Connection accepted, no reply yet. If silent: send second DM with inspector frame question.`;
  try {
    const res = await fetch("https://api.attio.com/v2/tasks", {
      method: "POST",
      headers: { "Authorization": `Bearer ${ATTIO_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          content, format: "plaintext", deadline_at: deadline, is_completed: false,
          linked_records: [{ target_object: "people", target_record_id: recordId }],
          assignees: [{ referenced_actor_type: "workspace-member", referenced_actor_id: JON_WORKSPACE_MEMBER_ID }],
        },
      }),
    });
    return res.ok;
  } catch { return false; }
}

// V3: write the acceptance back to the staging row.
async function markStagingAccepted(supabase: any, attioRecordId: string): Promise<{ updated: boolean; staging_id?: number }> {
  const { data, error } = await supabase
    .from('warm_outbound_staging')
    .update({
      dm_connection_accepted_at: new Date().toISOString(),
      dm_status: 'connection_accepted',
    })
    .eq('attio_record_id', attioRecordId)
    .eq('dm_status', 'connection_request_sent')
    .select('id')
    .maybeSingle();
  if (error || !data) return { updated: false };
  return { updated: true, staging_id: data.id };
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret") || "";
  if (!SECRET || secret !== SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let subject = "";
  let body = "";
  let fromAddr = "";
  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      const json = await req.json();
      subject = json.subject || ""; body = json.body || ""; fromAddr = json.from || "";
    } else {
      const raw = await req.text();
      subject = raw.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() || "";
      fromAddr = raw.match(/^From:\s*(.+)$/im)?.[1]?.trim() || "";
      const bodyStart = raw.indexOf("\r\n\r\n");
      body = bodyStart >= 0 ? raw.slice(bodyStart + 4) : raw;
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: "parse_failed", detail: String(e) }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const looksLikeLinkedIn =
    fromAddr.includes("linkedin.com") ||
    /accepted your (invitation|connection)|is now a connection|are now connected/i.test(subject);
  if (!looksLikeLinkedIn) {
    return new Response(JSON.stringify({ ok: false, reason: "not_linkedin_acceptance", from: fromAddr, subject }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const leadName = parseLinkedInName(subject, body);
  if (!leadName) {
    return new Response(JSON.stringify({ ok: false, reason: "name_not_parsed", subject }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const person = await findPersonInAttio(leadName);
  if (!person) {
    return new Response(JSON.stringify({ ok: false, reason: "person_not_in_attio", lead_name: leadName }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const attioUpdated = await updateAttioRecord(person.id.record_id);
  const taskCreated = await createFollowupTask(person.id.record_id, leadName);
  const stagingResult = await markStagingAccepted(supabase, person.id.record_id);

  return new Response(JSON.stringify({
    ok: true, lead_name: leadName,
    attio_record_id: person.id.record_id,
    attio_url: `https://app.attio.com/compliance-worxs/person/${person.id.record_id}`,
    record_updated: attioUpdated,
    task_created: taskCreated,
    staging_updated: stagingResult.updated,
    staging_id: stagingResult.staging_id,
    next_followup_at: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(),
  }, null, 2), { headers: { "Content-Type": "application/json" } });
});
