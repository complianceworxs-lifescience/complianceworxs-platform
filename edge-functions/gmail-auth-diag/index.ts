// gmail-auth-diag — captures the actual Google OAuth error to debug send failure
const GMAIL_CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const GMAIL_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const GMAIL_REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';
const ADMIN_SECRET = Deno.env.get('PHANTOMBUSTER_WEBHOOK_SECRET') ?? '';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== ADMIN_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }

  const env_check = {
    has_client_id: !!GMAIL_CLIENT_ID,
    has_client_secret: !!GMAIL_CLIENT_SECRET,
    has_refresh_token: !!GMAIL_REFRESH_TOKEN,
    client_id_prefix: GMAIL_CLIENT_ID.slice(0, 12),
    refresh_token_prefix: GMAIL_REFRESH_TOKEN.slice(0, 8),
  };

  // Step 1: refresh token
  let access_token: string | null = null;
  let refresh_status = 0;
  let refresh_body = '';
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GMAIL_CLIENT_ID,
        client_secret: GMAIL_CLIENT_SECRET,
        refresh_token: GMAIL_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    refresh_status = r.status;
    refresh_body = await r.text();
    if (r.ok) {
      try { access_token = JSON.parse(refresh_body).access_token; } catch {}
    }
  } catch (e) {
    refresh_body = `exception: ${(e as Error).message}`;
  }

  // Step 2: query token info to see scopes
  let scopes_status = 0;
  let scopes_body = '';
  if (access_token) {
    try {
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${access_token}`);
      scopes_status = r.status;
      scopes_body = await r.text();
    } catch (e) {
      scopes_body = `exception: ${(e as Error).message}`;
    }
  }

  return new Response(JSON.stringify({
    env_check,
    refresh_status,
    refresh_body: refresh_body.slice(0, 600),
    scopes_status,
    scopes_body: scopes_body.slice(0, 800),
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
