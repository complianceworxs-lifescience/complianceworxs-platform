// staging-to-attio v2 — May 7 2026
// V2 fixes:
// - Skip linkedin upsert (linkedin attribute not unique in Attio)
// - Use POST /records (create) when no email — accept duplicate-by-name as cost
// - Map case_file_interest to known Attio options only; drop if unknown
// - Don't fail row on case_file_interest mismatch — retry without that field

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ATTIO_API_KEY = Deno.env.get('ATTIO_API_KEY') ?? '';
const ATTIO_BASE    = 'https://api.attio.com/v2';

const BATCH_SIZE = 25;

// Whitelist of case_file_interest values known to exist in Attio
const VALID_CASE_FILES = new Set([
  'Batch Release', 'CAPA', 'Deviation', 'Change Control',
  'OOS', 'Data Integrity', 'Supplier Qualification', 'Stability OOT',
  'Complaint', 'Process Validation',
  'CCP Thermal Excursion', 'Raw Material Acceptance'
]);

function normalizeCaseFile(raw: string | null): string | null {
  if (!raw) return null;
  // Map our backfilled labels to Attio's known options
  const map: Record<string, string> = {
    'Batch Release Authorization': 'Batch Release',
    'CAPA Effectiveness': 'CAPA',
    'Deviation Root Cause': 'Deviation',
    'Change Control Risk': 'Change Control',
    'OOS Investigation': 'OOS',
    'Stability OOT': 'Stability OOT',
    'Complaint Investigation': 'Complaint',
    'Supplier Qualification': 'Supplier Qualification',
    'Data Integrity': 'Data Integrity',
    'Process Validation': 'Process Validation',
  };
  const mapped = map[raw] || raw;
  return VALID_CASE_FILES.has(mapped) ? mapped : null;
}

async function attioRequest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${ATTIO_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ATTIO_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Attio ${method} ${path} \u2192 ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

Deno.serve(async (req: Request) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: leads, error: lErr } = await supabase
    .from('warm_outbound_staging')
    .select('id, full_name, first_name, last_name, email, linkedin_url, job_title, company, case_file_interest, source')
    .is('attio_record_id', null)
    .is('archived_at', null)
    .not('full_name', 'is', null)
    .or('email.not.is.null,linkedin_url.not.is.null')
    .order('id', { ascending: false })
    .limit(BATCH_SIZE);

  if (lErr) {
    return new Response(JSON.stringify({ ok: false, error: lErr.message }), { status: 500 });
  }

  if (!leads || leads.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0, message: 'no leads to migrate' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let created = 0;
  let failed = 0;
  const errors: any[] = [];

  for (const lead of leads) {
    try {
      const firstName = lead.first_name || (lead.full_name ? lead.full_name.split(' ')[0] : '');
      const lastName  = lead.last_name  || (lead.full_name ? lead.full_name.split(' ').slice(1).join(' ') : '');
      const cfi       = normalizeCaseFile(lead.case_file_interest);

      const buildValues = (includeCFI: boolean): Record<string, unknown> => {
        const v: Record<string, unknown> = {
          name: [{ first_name: firstName, last_name: lastName, full_name: lead.full_name }],
          outreach_status: 'Not Contacted',
          capture_source: lead.source || 'phantombuster',
        };
        if (lead.email)        v.email_addresses = [{ email_address: lead.email }];
        if (lead.linkedin_url) v.linkedin        = lead.linkedin_url;
        if (lead.job_title)    v.job_title       = lead.job_title;
        if (includeCFI && cfi) v.case_file_interest = cfi;
        return v;
      };

      let attioRecord;
      const tryUpsert = async (vals: Record<string, unknown>) => {
        if (lead.email) {
          // Upsert by email — reliable
          return await attioRequest(
            'PUT',
            '/objects/people/records?matching_attribute=email_addresses',
            { data: { values: vals } }
          );
        }
        // No email — create new record (may dupe by name, accept that cost)
        return await attioRequest('POST', '/objects/people/records', { data: { values: vals } });
      };

      try {
        attioRecord = await tryUpsert(buildValues(true));
      } catch (err) {
        const msg = String(err);
        // If case_file_interest caused failure, retry without it
        if (msg.includes('value_not_found') || msg.includes('select option')) {
          attioRecord = await tryUpsert(buildValues(false));
        } else {
          throw err;
        }
      }

      const attioId = attioRecord?.data?.id?.record_id;
      if (attioId) {
        await supabase
          .from('warm_outbound_staging')
          .update({ attio_record_id: attioId, pushed_at: new Date().toISOString(), push_error: null })
          .eq('id', lead.id);
        created++;
      }
    } catch (err) {
      const errMsg = String(err).slice(0, 500);
      await supabase
        .from('warm_outbound_staging')
        .update({ push_error: errMsg })
        .eq('id', lead.id);
      errors.push({ id: lead.id, name: lead.full_name, err: errMsg.slice(0, 200) });
      failed++;
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed: leads.length, created, failed, errors: errors.slice(0, 5) }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
