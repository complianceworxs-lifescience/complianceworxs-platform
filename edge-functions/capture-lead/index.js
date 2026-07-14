// capture-lead v76 — plain JS, no TypeScript annotations
// Writes to form_submissions only. (v76: removed dead warm_outbound_staging write — table deleted.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const SLUG_TO_SKU = {
  'process-validation': 'CF01', 'batch-release': 'CF02', 'oos-investigation': 'CF03',
  'deviation-risk-assessment': 'CF04', 'change-control': 'CF05', 'capa-effectiveness': 'CF06',
  'data-integrity': 'CF07', 'supplier-qualification': 'CF08', 'stability-oot': 'CF09', 'complaint-investigation': 'CF10',
};
const SLUG_TO_TITLE = {
  'process-validation': 'Process Validation Conclusion', 'batch-release': 'Batch Release Authorization',
  'oos-investigation': 'OOS Investigation', 'deviation-risk-assessment': 'Deviation Risk Authorization',
  'change-control': 'Change Control Risk', 'capa-effectiveness': 'CAPA Effectiveness',
  'data-integrity': 'Data Integrity', 'supplier-qualification': 'Supplier Qualification',
  'stability-oot': 'Stability OOT', 'complaint-investigation': 'Complaint Investigation',
};

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com','guerrillamail.com','tempmail.com','10minutemail.com',
  'throwaway.email','yopmail.com','trashmail.com','sharklasers.com',
  'maildrop.cc','tempmailo.com','getnada.com','mintemail.com',
  'mohmal.com','fakeinbox.com','dispostable.com',
]);

function normalizeEmail(email) { return email.trim().toLowerCase(); }

function resolveSlug(pathname) {
  for (const key of Object.keys(SLUG_TO_SKU)) {
    if (pathname.includes(key)) return { sku: SLUG_TO_SKU[key], slug: key, title: SLUG_TO_TITLE[key] };
  }
  return { sku: null, slug: null, title: null };
}

function isDisposableEmail(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return true;
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  if (domain === 'gmail.com') {
    const local = email.split('@')[0] || '';
    if ((local.match(/\./g) || []).length >= 4) return true;
    if (local.includes('+')) return true;
  }
  return false;
}

function looksLikeGibberish(s) {
  if (!s) return false;
  const str = s.trim();
  if (str.length < 3) return false;
  const letters = str.replace(/[^a-zA-Z]/g, '');
  if (letters.length >= 6) {
    const vowels = (letters.match(/[aeiouAEIOU]/g) || []).length;
    if (vowels / letters.length < 0.20) return true;
  }
  if (/[bcdfghjklmnpqrstvwxyz]{4,}/i.test(letters)) return true;
  if (/\d/.test(str)) return true;
  return false;
}

function scoreSpam(input) {
  let score = 0;
  const reasons = [];
  if (input.honeypot && input.honeypot.trim().length > 0) { score += 100; reasons.push('honeypot_filled'); }
  if (isDisposableEmail(input.email)) { score += 60; reasons.push('disposable_email'); }
  if (looksLikeGibberish(input.name)) { score += 60; reasons.push('gibberish_name'); }
  if (looksLikeGibberish(input.company)) { score += 60; reasons.push('gibberish_company'); }
  const local = input.email.split('@')[0] || '';
  const domain = input.email.split('@')[1]?.toLowerCase() || '';
  const freeWebmail = ['hotmail.com','outlook.com','live.com','yahoo.com','aol.com','icloud.com'];
  if (freeWebmail.includes(domain) && /^[a-z]+\d{3,}$/i.test(local)) {
    score += 35; reasons.push('random_local_part_freemail');
  }
  return { score, reasons };
}

async function callEdgeFunction(name, body) {
  return fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
    body: JSON.stringify(body),
  }).catch(err => console.error(`${name} call failed:`, err));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), { status: 400 }); }

  const honeypot = body.honeypot || body.website || body.url || body.phone_number_alt || '';
  const { email, user_id, case_file, name, company } = body;

  if (!email || !email.includes('@')) return new Response(JSON.stringify({ success: false, error: 'Invalid email' }), { status: 400 });

  const ne = normalizeEmail(email);
  const { sku, slug, title } = resolveSlug(case_file || '');
  const spam = scoreSpam({ email: ne, honeypot, name, company });
  const isBlocked = spam.score >= 50;

  const fullName = [body.first_name, body.last_name].filter(Boolean).join(' ') || name || null;
  const firstName = body.first_name || (name ? name.split(' ')[0] : null);
  const lastName = body.last_name || (name && name.includes(' ') ? name.split(' ').slice(1).join(' ') : null);

  const { data: submission, error: insertErr } = await supabase
    .from('form_submissions')
    .upsert({
      email: ne, normalized_email: ne,
      first_name: firstName, last_name: lastName, full_name: fullName,
      company: company || null,
      source: body.source || 'lock_overlay',
      page: case_file || null,
      case_file_interest: title || null,
      user_id: user_id || null,
      utm_source: body.utm_source || null,
      utm_medium: body.utm_medium || null,
      utm_campaign: body.utm_campaign || null,
      spam_score: spam.score,
      spam_reasons: spam.reasons,
      is_blocked: isBlocked,
    }, { onConflict: 'normalized_email,source,page' })
    .select().single();

  if (insertErr) {
    console.error('form_submissions insert error:', insertErr);
    return new Response(JSON.stringify({ success: false, error: insertErr.message }), { status: 500 });
  }

  if (isBlocked) {
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  // Fire outreach email downstream (non-blocking)
  callEdgeFunction('lead-outreach-email', {
    record: { id: submission.id, email: ne, first_name: firstName, name: fullName, company: company || null, title: body.title || null, source: body.source || 'lock_overlay', page: case_file || '', utm_source: body.utm_source || null }
  });

  return new Response(JSON.stringify({ success: true, submissionId: submission.id, sku, slug }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
});
