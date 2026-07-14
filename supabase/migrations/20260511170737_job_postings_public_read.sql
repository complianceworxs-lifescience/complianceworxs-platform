CREATE POLICY "Public can read active job postings"
ON public.job_postings
FOR SELECT
TO anon, authenticated
USING (is_active = true);