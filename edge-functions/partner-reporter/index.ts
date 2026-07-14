import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const PB_SECRET = Deno.env.get('PHANTOMBUSTER_WEBHOOK_SECRET') ?? '';

const FROM_ADDRESS = 'ComplianceWorxs Partner <partners@complianceworxs.com>';
const REPLY_TO = 'jon@complianceworxs.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function money(cents: number) {
  return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function emailShell(title: string, body: string) {
  return `<!DOCTYPE html>
<html><body style="margin:0;background:#F5F6F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#3A3A3A;">
  <div style="max-width:640px;margin:0 auto;padding:32px 24px;">
    <div style="background:#fff;border-radius:10px;padding:32px;border:1px solid #E5E7EB;">
      <div style="border-bottom:1px solid #E5E7EB;padding-bottom:16px;margin-bottom:24px;">
        <p style="margin:0;font-size:12px;letter-spacing:0.14em;color:#0E6F86;text-transform:uppercase;font-weight:600;">ComplianceWorxs Partner Program</p>
        <h1 style="margin:8px 0 0;font-family:Georgia,serif;font-size:22px;color:#0A4F62;font-weight:700;">${title}</h1>
      </div>
      ${body}
    </div>
    <p style="text-align:center;color:#888;font-size:12px;margin-top:24px;">ComplianceWorxs &middot; <a href="https://complianceworxs.com" style="color:#0E6F86;text-decoration:none;">complianceworxs.com</a></p>
  </div>
</body></html>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_ADDRESS, to, reply_to: REPLY_TO, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return res.json();
}

// =========== CONVERSION ALERT (real-time) ===========
async function sendConversionAlerts(supabase: any) {
  const { data: pending } = await supabase
    .from('partner_commissions')
    .select('id, partner_id, partner_code, amount_cents, commission_cents, earned_at, contact_id, partners(partner_code, contact_full_name, report_email, conversion_alerts_enabled)')
    .is('alert_sent_at', null)
    .order('earned_at', { ascending: true });

  if (!pending || pending.length === 0) return { sent: 0 };

  let sent = 0; let skipped = 0;
  for (const c of pending) {
    const partner: any = c.partners;
    if (!partner?.report_email) { skipped++; continue; }
    if (partner.conversion_alerts_enabled === false) {
      await supabase.from('partner_commissions').update({ alert_sent_at: new Date().toISOString() }).eq('id', c.id);
      skipped++; continue;
    }

    const firstName = (partner.contact_full_name || '').split(' ')[0] || partner.partner_code;
    const body = `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${firstName} —</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">A new sale was just attributed to your <strong>${c.partner_code}</strong> code. Commission credited.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0 24px;">
        <tr><td style="padding:12px 16px;background:#F5F6F7;font-size:13px;color:#6B7280;text-transform:uppercase;letter-spacing:0.08em;width:160px;">Sale amount</td><td style="padding:12px 16px;background:#F5F6F7;font-size:18px;font-weight:600;color:#0A4F62;">${money(c.amount_cents)}</td></tr>
        <tr><td style="padding:12px 16px;font-size:13px;color:#6B7280;text-transform:uppercase;letter-spacing:0.08em;">Your commission</td><td style="padding:12px 16px;font-size:22px;font-weight:700;color:#D86A2B;font-family:Georgia,serif;">${money(c.commission_cents)}</td></tr>
        <tr><td style="padding:12px 16px;background:#F5F6F7;font-size:13px;color:#6B7280;text-transform:uppercase;letter-spacing:0.08em;">Earned at</td><td style="padding:12px 16px;background:#F5F6F7;font-size:14px;color:#3A3A3A;">${new Date(c.earned_at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} EST</td></tr>
      </table>
      <p style="margin:0;font-size:14px;line-height:1.6;color:#6B7280;">Payout via Stripe Connect, Net 30 after month end.</p>
    `;

    try {
      await sendEmail(partner.report_email, `New ${c.partner_code} commission: ${money(c.commission_cents)}`, emailShell('New sale attributed', body));
      await supabase.from('partner_commissions').update({ alert_sent_at: new Date().toISOString() }).eq('id', c.id);
      sent++;
    } catch (e) {
      console.error('Conversion alert failed:', (e as Error).message);
    }
  }

  return { sent, skipped };
}

// =========== WEEKLY DIGEST (Mondays 8 AM EST) ===========
async function sendWeeklyDigest(supabase: any) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: partners } = await supabase
    .from('partners')
    .select('id, partner_code, partner_name, contact_full_name, report_email, weekly_digest_enabled')
    .eq('status', 'active')
    .eq('weekly_digest_enabled', true)
    .not('report_email', 'is', null);

  if (!partners || partners.length === 0) return { sent: 0 };

  let sent = 0;
  for (const p of partners) {
    const { data: clicks } = await supabase
      .from('partner_referrals')
      .select('id', { count: 'exact', head: true })
      .eq('partner_id', p.id)
      .gte('first_seen_at', since);

    const { data: commissions } = await supabase
      .from('partner_commissions')
      .select('amount_cents, commission_cents')
      .eq('partner_id', p.id)
      .gte('earned_at', since);

    const clickCount = (clicks as any) || 0;
    const conversionCount = (commissions || []).length;
    const totalCommission = (commissions || []).reduce((sum: number, c: any) => sum + (c.commission_cents || 0), 0);
    const totalSales = (commissions || []).reduce((sum: number, c: any) => sum + (c.amount_cents || 0), 0);

    const firstName = (p.contact_full_name || '').split(' ')[0] || p.partner_code;
    const conversionRate = clickCount > 0 ? `${((conversionCount / clickCount) * 100).toFixed(1)}%` : '—';

    const body = `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${firstName} — here's last week's activity for your <strong>${p.partner_code}</strong> link.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0 24px;">
        <tr><td style="padding:14px 16px;background:#F5F6F7;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:0.1em;width:50%;">Link clicks</td><td style="padding:14px 16px;background:#F5F6F7;font-size:24px;font-weight:700;color:#0A4F62;font-family:Georgia,serif;">${clickCount}</td></tr>
        <tr><td style="padding:14px 16px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:0.1em;">Conversions</td><td style="padding:14px 16px;font-size:24px;font-weight:700;color:#0A4F62;font-family:Georgia,serif;">${conversionCount}</td></tr>
        <tr><td style="padding:14px 16px;background:#F5F6F7;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:0.1em;">Conversion rate</td><td style="padding:14px 16px;background:#F5F6F7;font-size:18px;font-weight:600;color:#0E6F86;">${conversionRate}</td></tr>
        <tr><td style="padding:14px 16px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:0.1em;">Sales attributed</td><td style="padding:14px 16px;font-size:18px;font-weight:600;color:#0A4F62;">${money(totalSales)}</td></tr>
        <tr><td style="padding:14px 16px;background:#FEF7E6;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:0.1em;">Commission earned</td><td style="padding:14px 16px;background:#FEF7E6;font-size:24px;font-weight:700;color:#D86A2B;font-family:Georgia,serif;">${money(totalCommission)}</td></tr>
      </table>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#6B7280;">All commissions paid via Stripe Connect, Net 30 after month end.</p>
      <p style="margin:0;font-size:14px;line-height:1.6;color:#6B7280;">Your tracking link: <a href="https://complianceworxs.com/${p.partner_code.toLowerCase()}" style="color:#0E6F86;font-weight:600;">complianceworxs.com/${p.partner_code.toLowerCase()}</a></p>
    `;

    try {
      await sendEmail(p.report_email, `${p.partner_code} weekly digest — ${money(totalCommission)} earned`, emailShell('Weekly partner digest', body));
      await supabase.from('partners').update({ last_weekly_digest_at: new Date().toISOString() }).eq('id', p.id);
      sent++;
    } catch (e) {
      console.error(`Weekly digest failed for ${p.partner_code}:`, (e as Error).message);
    }
  }

  return { sent };
}

// =========== MONTHLY STATEMENT (1st of month) ===========
async function sendMonthlyStatement(supabase: any) {
  const now = new Date();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthLabel = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const payoutDate = new Date(now.getFullYear(), now.getMonth(), 30);
  const payoutLabel = payoutDate.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const { data: partners } = await supabase
    .from('partners')
    .select('id, partner_code, partner_name, contact_full_name, report_email, monthly_statement_enabled')
    .eq('status', 'active')
    .eq('monthly_statement_enabled', true)
    .not('report_email', 'is', null);

  if (!partners || partners.length === 0) return { sent: 0 };

  let sent = 0;
  for (const p of partners) {
    const { data: commissions } = await supabase
      .from('partner_commissions')
      .select('amount_cents, commission_cents, earned_at, partner_code')
      .eq('partner_id', p.id)
      .gte('earned_at', lastMonthStart)
      .lt('earned_at', thisMonthStart)
      .order('earned_at', { ascending: true });

    if (!commissions || commissions.length === 0) continue;

    const totalCommission = commissions.reduce((sum: number, c: any) => sum + (c.commission_cents || 0), 0);
    const totalSales = commissions.reduce((sum: number, c: any) => sum + (c.amount_cents || 0), 0);
    const firstName = (p.contact_full_name || '').split(' ')[0] || p.partner_code;

    const lineItems = commissions.map((c: any) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #F0F0F0;font-size:13px;color:#6B7280;">${new Date(c.earned_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #F0F0F0;font-size:14px;color:#3A3A3A;">${money(c.amount_cents)} sale</td>
        <td style="padding:10px 12px;border-bottom:1px solid #F0F0F0;font-size:14px;font-weight:600;color:#D86A2B;text-align:right;">${money(c.commission_cents)}</td>
      </tr>`).join('');

    const body = `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${firstName} — here's your <strong>${monthLabel}</strong> statement for code <strong>${p.partner_code}</strong>.</p>
      <div style="background:linear-gradient(180deg,#0A5F74 0%,#0A4F62 100%);color:#fff;padding:24px;border-radius:8px;text-align:center;margin:16px 0 24px;">
        <p style="margin:0 0 4px;font-size:13px;letter-spacing:0.1em;color:#B8CDD3;text-transform:uppercase;">Total earned ${monthLabel}</p>
        <p style="margin:0;font-family:Georgia,serif;font-size:42px;font-weight:800;color:#F7C51E;line-height:1;">${money(totalCommission)}</p>
        <p style="margin:6px 0 0;font-size:13px;color:#E7F0F3;">${commissions.length} sales · ${money(totalSales)} total volume</p>
      </div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #E5E7EB;border-radius:6px;overflow:hidden;margin-bottom:24px;">
        <thead><tr><th style="padding:12px;background:#0A5F74;color:#fff;font-size:12px;text-align:left;letter-spacing:0.06em;text-transform:uppercase;">Date</th><th style="padding:12px;background:#0A5F74;color:#fff;font-size:12px;text-align:left;letter-spacing:0.06em;text-transform:uppercase;">Sale</th><th style="padding:12px;background:#0A5F74;color:#fff;font-size:12px;text-align:right;letter-spacing:0.06em;text-transform:uppercase;">Commission</th></tr></thead>
        <tbody>${lineItems}</tbody>
      </table>
      <div style="background:#FEF7E6;border-left:4px solid #F7C51E;padding:14px 18px;border-radius:4px;">
        <p style="margin:0;font-size:14px;line-height:1.55;"><strong style="color:#0A4F62;">Payout date: ${payoutLabel}</strong> via Stripe Connect (Net 30 after month end).</p>
      </div>
    `;

    try {
      await sendEmail(p.report_email, `${p.partner_code} ${monthLabel} statement — ${money(totalCommission)}`, emailShell(`${monthLabel} statement`, body));
      await supabase.from('partners').update({ last_monthly_statement_at: new Date().toISOString() }).eq('id', p.id);
      sent++;
    } catch (e) {
      console.error(`Monthly statement failed for ${p.partner_code}:`, (e as Error).message);
    }
  }

  return { sent };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret') || '';
  if (!PB_SECRET || secret !== PB_SECRET) {
    return new Response('unauthorized', { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const path = url.pathname.split('/').pop() || '';

  try {
    if (path === 'conversion-alerts') {
      const r = await sendConversionAlerts(supabase);
      return new Response(JSON.stringify(r), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (path === 'weekly-digest') {
      const r = await sendWeeklyDigest(supabase);
      return new Response(JSON.stringify(r), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (path === 'monthly-statement') {
      const r = await sendMonthlyStatement(supabase);
      return new Response(JSON.stringify(r), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      ok: true,
      endpoints: ['/conversion-alerts', '/weekly-digest', '/monthly-statement']
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
