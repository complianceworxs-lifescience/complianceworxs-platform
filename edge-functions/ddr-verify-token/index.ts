import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, apikey, authorization',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json();
    const token = (body.token || '').toString().trim();

    if (!token || token.length < 20) {
      return json({ valid: false, reason: 'missing_or_malformed' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: row, error } = await supabase
      .from('ddr_access_tokens')
      .select('id, email, full_name, source, expires_at, revoked_at, access_count')
      .eq('token', token)
      .maybeSingle();

    if (error) {
      console.error('Supabase lookup error:', error);
      return json({ valid: false, reason: 'lookup_error' }, 500);
    }

    if (!row) {
      return json({ valid: false, reason: 'not_found' });
    }

    if (row.revoked_at) {
      return json({ valid: false, reason: 'revoked' });
    }

    const now = new Date();
    const expires = new Date(row.expires_at);
    if (expires < now) {
      return json({ valid: false, reason: 'expired', expires_at: row.expires_at });
    }

    // Update access metadata (fire-and-forget)
    supabase
      .from('ddr_access_tokens')
      .update({
        last_accessed_at: now.toISOString(),
        access_count: (row.access_count || 0) + 1,
      })
      .eq('id', row.id)
      .then(({ error: updErr }) => {
        if (updErr) console.error('Access count update failed (non-fatal):', updErr);
      });

    return json({
      valid: true,
      email: row.email,
      full_name: row.full_name,
      source: row.source,
      expires_at: row.expires_at,
    });

  } catch (err) {
    console.error('ddr-verify-token error:', err);
    return json({ valid: false, reason: 'server_error', message: (err as Error).message }, 500);
  }
});
