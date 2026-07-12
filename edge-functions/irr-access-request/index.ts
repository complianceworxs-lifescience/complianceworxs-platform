import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { email, decision_type, industry, context, referrer, session_source } = body;

    if (!email || !decision_type || !industry) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const userAgent = req.headers.get('user-agent') ?? null;

    const { data, error } = await supabase
      .from('irr_access_requests')
      .insert({
        email,
        decision_type,
        industry,
        context: context || null,
        referrer: referrer || null,
        session_source: session_source || null,
        user_agent: userAgent,
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      return new Response(JSON.stringify({ error: 'Database error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fire-and-forget Attio push. Do not block on Attio failure.
    const attioApiKey = Deno.env.get('ATTIO_API_KEY');
    if (attioApiKey) {
      try {
        await fetch('https://api.attio.com/v2/objects/people/records', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${attioApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            data: {
              values: {
                email_addresses: [{ email_address: email }],
                description: `IRR Access Request — ${decision_type} / ${industry}${context ? '\n\nContext: ' + context : ''}`,
              },
            },
          }),
        }).catch((e) => console.error('Attio push failed (non-blocking):', e));
      } catch (e) {
        console.error('Attio push exception (non-blocking):', e);
      }
    }

    return new Response(JSON.stringify({ success: true, id: data.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Handler error:', e);
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});