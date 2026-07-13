const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    Prefer: 'return=representation',
  };
}

export async function createJob(inputPayload: unknown): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/irr_jobs`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify([{ input_payload: inputPayload, status: 'queued' }]),
  });
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows[0]?.job_id) {
    throw new Error(`Failed to create job row (status ${res.status}): ${JSON.stringify(rows).slice(0, 500)}`);
  }
  return rows[0].job_id;
}
