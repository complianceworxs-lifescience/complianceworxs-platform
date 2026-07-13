// gemini-key-probe — confirms GEMINI_API_KEY is set in env and reachable
Deno.serve(async () => {
  const key = Deno.env.get('GEMINI_API_KEY') || '';
  const present = key.length > 0;
  const preview = present ? `${key.slice(0, 6)}...${key.slice(-4)}` : 'MISSING';

  // Test actual API reachability with a 1-token ping
  let api_test: any = { skipped: !present };
  if (present) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Reply with just: OK' }] }],
            generationConfig: { maxOutputTokens: 10 },
          }),
          signal: AbortSignal.timeout(8000),
        },
      );
      api_test = {
        status: r.status,
        ok: r.ok,
        body_preview: (await r.text()).slice(0, 400),
      };
    } catch (e) {
      api_test = { exception: (e as Error).message };
    }
  }

  return new Response(
    JSON.stringify({ key_present: present, key_preview: preview, api_test }, null, 2),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
