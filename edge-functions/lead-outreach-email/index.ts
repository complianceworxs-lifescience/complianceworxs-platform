// lead-outreach-email v7 — May 7 2026
// V7: Reads from form_submissions instead of contacts/leads/events (dropped).
// Generates page-aware email draft and writes it as Attio note for manual send.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ATTIO_KEY    = Deno.env.get('ATTIO_API_KEY') ?? '';
const ATTIO_API    = 'https://api.attio.com/v2';

const SKIP_DOMAINS = ['complianceworxs.com', 'coursworx.com'];

interface Lead {
  id: string;
  email: string;
  first_name?: string;
  name?: string;
  company?: string;
  title?: string;
  source?: string;
  page?: string;
  utm_source?: string;
}

function getCaseFileInterest(page: string): string | null {
  if (page.includes('batch-release'))      return 'Batch Release';
  if (page.includes('capa'))               return 'CAPA';
  if (page.includes('deviation'))          return 'Deviation';
  if (page.includes('process-validation')) return 'Process Validation';
  if (page.includes('change-control'))     return 'Change Control';
  if (page.includes('oos'))                return 'OOS';
  if (page.includes('data-integrity'))     return 'Data Integrity';
  if (page.includes('complaint'))          return 'Complaint';
  if (page.includes('supplier'))           return 'Supplier Qualification';
  if (page.includes('stability'))          return 'Stability OOT';
  return null;
}

function getEmailTemplate(lead: Lead): { subject: string; body: string; key: string } {
  const source = (lead.source ?? '').toLowerCase();
  const page   = (lead.page   ?? '').toLowerCase();
  const co     = lead.company ? ` at ${lead.company}` : '';
  const first  = lead.first_name ?? lead.name?.split(' ')[0] ?? lead.email.split('@')[0];

  if (source.includes('assessment')) {
    return {
      key: 'assessment-completion',
      subject: 'Your authorization assessment',
      body: `${first} \u2014\n\nYou went through the authorization assessment. Based on what you answered, the gap isn't in your documentation \u2014 it's in the decision trail behind it.\n\nThe records exist. The authorization logic that justified them doesn't.\n\nThat's the exact thing an FDA investigator reconstructs during an inspection. Not whether the CAPA was closed \u2014 but who authorized the closure, and what evidence was reviewed at that moment.\n\nIs that the exposure you're trying to close?\n\nJon Nugent\nComplianceWorxs\ncomplianceworxs.com`
    };
  }

  if (page.includes('batch-release')) {
    return {
      key: 'lock-batch-release',
      subject: 'The decision behind the batch release',
      body: `${first} \u2014\n\nMost QA leaders${co} can produce the batch record and the CoA. What they struggle to produce \u2014 under direct regulatory scrutiny, in the room, with an inspector waiting \u2014 is the authorization record behind the release decision.\n\nNot what the results showed. Who made the call, on what evidence, and why that conclusion was justified at that moment.\n\nI put together a scenario that maps exactly to what that inspector question looks like in practice:\n\ncases.complianceworxs.com/batch-release-authorization\n\nTake a look and tell me if that's the gap you were evaluating.\n\nJon Nugent\nComplianceWorxs\ncomplianceworxs.com`
    };
  }

  if (page.includes('capa')) {
    return {
      key: 'lock-capa',
      subject: 'CAPA closure authorization',
      body: `${first} \u2014\n\nClosing a CAPA isn't the hard part. The hard part is demonstrating \u2014 under direct regulatory scrutiny \u2014 who authorized the closure, what evidence they reviewed at that moment, and why they concluded the corrective action was effective.\n\nWe put the full scenario together here:\n\ncases.complianceworxs.com/capa-effectiveness\n\nTell me if that's the gap you were looking at.\n\nJon Nugent\nComplianceWorxs\ncomplianceworxs.com`
    };
  }

  if (page.includes('deviation')) {
    return {
      key: 'lock-deviation',
      subject: 'The authorization record behind your deviation',
      body: `${first} \u2014\n\nMost quality teams can produce the deviation report. What they can't produce quickly \u2014 under direct inspection pressure \u2014 is who authorized the risk disposition, on what evidence, and why that conclusion was justified at the moment the decision was made.\n\nWe put the full scenario together here:\n\ncases.complianceworxs.com/deviation-root-cause-analysis\n\nTell me if that's the exposure you were working through.\n\nJon Nugent\nComplianceWorxs\ncomplianceworxs.com`
    };
  }

  if (page.includes('process-validation')) {
    return {
      key: 'lock-process-validation',
      subject: 'Who authorized the validation conclusion',
      body: `${first} \u2014\n\nThe validation protocol exists. The data exists. The summary report exists.\n\nWhat rarely exists as a formal record is who authorized the conclusion that the process was validated \u2014 based on what evidence, how risk was evaluated, and why that determination was justified at that moment.\n\nWe put the full scenario together here:\n\ncases.complianceworxs.com/process-validation-conclusion\n\nTell me if that's what you were evaluating.\n\nJon Nugent\nComplianceWorxs\ncomplianceworxs.com`
    };
  }

  if (page.includes('change-control')) {
    return {
      key: 'lock-change-control',
      subject: 'The decision record behind change control',
      body: `${first} \u2014\n\nChange control documentation is well understood. What's less understood is the authorization record behind the risk determination \u2014 who evaluated the risk, what evidence they reviewed, and why they concluded the change was acceptable.\n\nWe put the full scenario together here:\n\ncases.complianceworxs.com/change-control-risk\n\nTell me if that's the gap you were looking at.\n\nJon Nugent\nComplianceWorxs\ncomplianceworxs.com`
    };
  }

  return {
    key: 'decision-ownership',
    subject: `Decision authorization${lead.company ? ' at ' + lead.company : ''}`,
    body: `${first} \u2014\n\nMost QA leaders${co} can point to the documentation. What they struggle to answer \u2014 under direct regulatory scrutiny, in the room, with an inspector waiting \u2014 is who authorized a specific compliance decision, based on what evidence, and why that conclusion was justified at that moment.\n\nThat's a different question than whether the work was done. And it's the one that rarely has a formal record behind it.\n\nI put together a scenario that maps exactly to what that inspector question looks like in practice:\n\ncases.complianceworxs.com/batch-release-authorization\n\nTake a look and tell me if that's the gap you were evaluating.\n\nJon Nugent\nComplianceWorxs\ncomplianceworxs.com`
  };
}

async function attioRequest(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${ATTIO_API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ATTIO_KEY}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Attio ${method} ${path} -> ${res.status}: ${err}`);
    return null;
  }
  return res.json();
}

async function attioUpsertPerson(lead: Lead): Promise<string | null> {
  const fullName = (lead.first_name || lead.name || '').trim();
  const parts    = fullName.split(' ');
  const cfi      = getCaseFileInterest(lead.page ?? '');

  const values: Record<string, unknown> = {
    email_addresses:  [{ email_address: lead.email }],
    lifecycle_stage:  'Prospect',
    outreach_status:  'Engaged',
    capture_source:   lead.source ?? null,
  };

  if (fullName) {
    values.name = [{
      first_name: parts[0] ?? '',
      last_name:  parts.slice(1).join(' ') || '',
      full_name:  fullName,
    }];
  }
  if (lead.title)   values.job_title          = lead.title;
  if (cfi)          values.case_file_interest  = cfi;
  if (lead.company) values.company_name        = lead.company;

  const result = await attioRequest('/objects/people/records?matching_attribute=email_addresses', 'PUT', { data: { values } });
  return result?.data?.id?.record_id ?? null;
}

async function attioAddNote(recordId: string, title: string, content: string) {
  await attioRequest('/notes', 'POST', {
    data: {
      parent_object: 'people',
      parent_record_id: recordId,
      title,
      format: 'plaintext',
      content_plaintext: content,
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  }

  let payload: { record?: Lead };
  try { payload = await req.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400 }); }

  const lead: Lead = payload.record ?? (payload as unknown as Lead);
  if (!lead?.email) return new Response(JSON.stringify({ skipped: 'no email' }), { status: 200 });

  const email = lead.email.trim().toLowerCase();
  if (SKIP_DOMAINS.some(d => email.endsWith(d))) {
    return new Response(JSON.stringify({ skipped: 'internal domain' }), { status: 200 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  // Idempotency: skip if outreach already sent for this submission
  const { data: already } = await supabase
    .from('form_submissions')
    .select('id, outreach_email_sent_at')
    .eq('id', lead.id)
    .maybeSingle();

  if (already?.outreach_email_sent_at) {
    return new Response(JSON.stringify({ skipped: 'already_sent', email }), { status: 200 });
  }

  const template = getEmailTemplate(lead);
  let attioRecordId: string | null = null;

  if (ATTIO_KEY) {
    try {
      attioRecordId = await attioUpsertPerson(lead);
      if (attioRecordId) {
        const noteContent =
          `SEND FROM GMAIL \u2014 Subject: ${template.subject}\n\n` +
          `${template.body}\n\n---\n` +
          `Template: ${template.key}\n` +
          `Capture source: ${lead.source ?? 'unknown'}\n` +
          `Page: ${lead.page ?? 'unknown'}\n` +
          `Synced at: ${new Date().toISOString()}`;
        await attioAddNote(attioRecordId, `Outreach: ${template.subject}`, noteContent);
      }
    } catch (e) {
      console.error('Attio sync error (non-fatal):', e);
    }
  }

  // Mark form_submission as processed
  if (lead.id) {
    await supabase
      .from('form_submissions')
      .update({
        outreach_email_sent_at: new Date().toISOString(),
        outreach_template_key: template.key,
        attio_record_id: attioRecordId,
      })
      .eq('id', lead.id);
  }

  // Append to lead_outreach_log for historical tracking
  await supabase.from('lead_outreach_log').insert({
    lead_email: email,
    template_key: template.key,
    subject: template.subject,
    status: attioRecordId ? 'synced_to_attio' : 'attio_sync_failed',
    error_message: attioRecordId ? null : 'Attio sync returned no record ID',
    mailersend_id: attioRecordId ?? null,
  }).catch(e => console.error('lead_outreach_log insert non-fatal:', e));

  return new Response(
    JSON.stringify({ synced: !!attioRecordId, email, template: template.key, attio_id: attioRecordId }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
