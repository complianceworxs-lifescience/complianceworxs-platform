-- Create private storage bucket for IRR document uploads
-- 25MB limit per file, common compliance document types only
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'irr-uploads',
  'irr-uploads',
  false,
  26214400, -- 25MB
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'text/plain',
    'text/csv'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- RLS policy: only service_role can read/write (no public access; users get signed URLs via edge fn)
DROP POLICY IF EXISTS "Service role full access on irr-uploads" ON storage.objects;
CREATE POLICY "Service role full access on irr-uploads"
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id = 'irr-uploads')
WITH CHECK (bucket_id = 'irr-uploads');

-- Anonymous users can INSERT only (for direct browser uploads with anon key)
DROP POLICY IF EXISTS "Anon can upload to irr-uploads" ON storage.objects;
CREATE POLICY "Anon can upload to irr-uploads"
ON storage.objects
FOR INSERT
TO anon
WITH CHECK (bucket_id = 'irr-uploads');
