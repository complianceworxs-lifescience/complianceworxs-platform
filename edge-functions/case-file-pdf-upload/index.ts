import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const UPLOAD_SECRET = Deno.env.get('PHANTOMBUSTER_WEBHOOK_SECRET') ?? '';

const BUCKET = 'Case Files';
const ALLOWED_FILENAMES = new Set([
  'CW-Case-File-01-Process-Validation-Conclusion.pdf',
  'CW-Case-File-02-Batch-Release-Authorization.pdf',
  'CW-Case-File-03-OOS-Investigation-Closure.pdf',
  'CW-Case-File-04-Deviation-Risk-Assessment.pdf',
  'CW-Case-File-05-Change-Control-Approval.pdf',
  'CW-Case-File-06-CAPA-Effectiveness-Decision.pdf',
  'CW-Case-File-07-Data-Integrity-Investigation.pdf',
  'CW-Case-File-08-Supplier-Qualification-Exception.pdf',
  'CW-Case-File-09-Stability-OOT-Evaluation.pdf',
  'CW-Case-File-10-Complaint-Investigation-Disposition.pdf',
]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, apikey, authorization',
};

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const secret = (body.secret ?? '').toString();
  if (!UPLOAD_SECRET || secret !== UPLOAD_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const filename = (body.filename ?? '').toString().trim();
  const pdfBase64 = (body.pdf_base64 ?? '').toString().trim();

  if (!filename || !ALLOWED_FILENAMES.has(filename)) {
    return new Response(JSON.stringify({
      error: 'invalid_filename',
      detail: 'filename must be one of the canonical case file names',
      allowed: Array.from(ALLOWED_FILENAMES),
    }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (!pdfBase64 || pdfBase64.length < 100) {
    return new Response(JSON.stringify({ error: 'missing_or_short_pdf_base64' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(pdfBase64);
  } catch (e) {
    return new Response(JSON.stringify({
      error: 'base64_decode_failed',
      detail: e instanceof Error ? e.message : String(e),
    }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    return new Response(JSON.stringify({
      error: 'not_a_pdf',
      detail: 'decoded bytes do not start with %PDF magic header',
      first_bytes: Array.from(bytes.slice(0, 8)),
    }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .storage
    .from(BUCKET)
    .upload(filename, bytes, {
      contentType: 'application/pdf',
      upsert: true,
      cacheControl: '0',
    });

  if (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'upload_failed',
      detail: error.message,
      filename,
      bucket: BUCKET,
    }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    filename,
    bucket: BUCKET,
    size_bytes: bytes.length,
    upload_path: data?.path ?? null,
    uploaded_at: new Date().toISOString(),
  }), {
    status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
