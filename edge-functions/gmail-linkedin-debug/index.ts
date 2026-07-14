// gmail-trash-inspector — list From: addresses of all trashed messages, no filtering
const GMAIL_CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const GMAIL_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const GMAIL_REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';
const ADMIN_SECRET = Deno.env.get('PHANTOMBUSTER_WEBHOOK_SECRET') ?? '';

async function getAccessToken(): Promise<string | null> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.access_token || null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }
  const token = await getAccessToken();
  if (!token) return new Response(JSON.stringify({ error: 'no_token' }), { status: 503 });

  const q = url.searchParams.get('q') || 'in:trash newer_than:30d';
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=200`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const j = await r.json();
  const messages = j.messages || [];
  const senders: Record<string, number> = {};
  const samples: any[] = [];
  
  for (let i = 0; i < Math.min(messages.length, 100); i++) {
    const m = messages[i];
    const tr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!tr.ok) continue;
    const tj = await tr.json();
    const headers = tj.payload?.headers || [];
    const from = (headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || '').slice(0, 100);
    const subject = (headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '').slice(0, 80);
    const date = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || '';
    const domainMatch = from.match(/@([\w.-]+)/);
    const domain = domainMatch ? domainMatch[1].toLowerCase() : 'unknown';
    senders[domain] = (senders[domain] || 0) + 1;
    if (samples.length < 30) samples.push({ from, subject, date, labels: tj.labelIds || [] });
  }

  const sortedSenders = Object.entries(senders).sort((a, b) => b[1] - a[1]);
  return new Response(JSON.stringify({
    total_in_query: j.resultSizeEstimate,
    inspected: Math.min(messages.length, 100),
    senders_by_domain: sortedSenders,
    samples,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
