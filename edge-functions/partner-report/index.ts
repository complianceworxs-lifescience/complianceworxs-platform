import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ATTIO_API_KEY = Deno.env.get('ATTIO_API_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await req.json();
    const {
      partner_code,
      partner_name,
      partner_email,
      client_name,
      client_company,
      client_email,
      client_title,
      introduction_date,
      introduction_method,
      notes
    } = body;

    // Validate required fields
    if (!partner_code || !partner_name || !partner_email || !client_name || !client_email || !introduction_date) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Verify partner code exists in partner_applications
    const { data: partner, error: partnerError } = await supabase
      .from('partner_applications')
      .select('id, full_name, email, referral_code, status')
      .eq('referral_code', partner_code.toUpperCase())
      .single();

    if (partnerError || !partner) {
      return new Response(JSON.stringify({ error: 'Invalid partner code. Please check your referral code and try again.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (partner.status !== 'approved') {
      return new Response(JSON.stringify({ error: 'Your partner application is not yet approved. Please wait for your approval confirmation.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check for duplicate — same partner code + client email
    const { data: existing } = await supabase
      .from('partner_referrals')
      .select('id')
      .eq('partner_code', partner_code.toUpperCase())
      .eq('client_email', client_email.toLowerCase())
      .single();

    if (existing) {
      return new Response(JSON.stringify({ error: 'A referral for this client email already exists under your partner code.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Insert referral
    const { data: referral, error: insertError } = await supabase
      .from('partner_referrals')
      .insert({
        partner_code: partner_code.toUpperCase(),
        partner_name,
        partner_email: partner_email.toLowerCase(),
        client_name,
        client_company: client_company || null,
        client_email: client_email.toLowerCase(),
        client_title: client_title || null,
        introduction_date,
        introduction_method: introduction_method || null,
        notes: notes || null,
        status: 'pending',
      })
      .select('id')
      .single();

    if (insertError) throw new Error('Failed to save referral: ' + insertError.message);

    // Upsert client to Attio as a lead with partner attribution
    if (ATTIO_API_KEY) {
      try {
        await fetch('https://api.attio.com/v2/objects/people/records', {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${ATTIO_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            data: {
              values: {
                email_addresses: [{ email_address: client_email.toLowerCase() }],
                partner_referral_code: partner_code.toUpperCase(),
                partner_name: partner_name,
                partner_referred_at: new Date().toISOString(),
                referral_id: referral.id,
              }
            },
            matching_attribute: 'email_addresses',
          }),
        });
      } catch (e) {
        console.error('Attio upsert failed:', e);
      }
    }

    console.log('Partner referral submitted:', referral.id, 'partner:', partner_code, 'client:', client_email);

    return new Response(JSON.stringify({
      success: true,
      referral_id: referral.id,
      message: 'Referral submitted successfully.'
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
