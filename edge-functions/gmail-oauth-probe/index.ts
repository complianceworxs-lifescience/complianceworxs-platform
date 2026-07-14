// gmail-oauth-probe — admin diagnostic. Returns the EXACT error from Google OAuth
// so we can see whether the refresh token is invalid, the client id mismatch, or scope issue.

const CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';
const PB_SECRET = Deno.env.get('PHANTOMBUSTER_WEBHOOK_SECRET') ?? '';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== PB_SECRET) return new Response('unauthorized', { status: 401 });

  const result: any = {
    has_client_id: !!CLIENT_ID,
    client_id_prefix: CLIENT_ID.slice(0, 12) + '...',
    has_client_secret: !!CLIENT_SECRET,
    has_refresh_token: !!REFRESH_TOKEN,
    refresh_token_length: REFRESH_TOKEN.length,
  };

  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    const text = await r.text();
    let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = text; }
    result.oauth_status = r.status;
    result.oauth_response = parsed;
  } catch (e) {
    result.oauth_error = (e as Error).message;
  }

  return new Response(JSON.stringify(result, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
