-- Allow anonymous (browser) inserts into leads for case file email capture.
-- No SELECT/UPDATE/DELETE granted — anon can only add new rows.
CREATE POLICY "Anon can insert leads"
  ON public.leads
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Also allow the authenticated role (in case users are logged into anything).
CREATE POLICY "Authenticated can insert leads"
  ON public.leads
  FOR INSERT
  TO authenticated
  WITH CHECK (true);