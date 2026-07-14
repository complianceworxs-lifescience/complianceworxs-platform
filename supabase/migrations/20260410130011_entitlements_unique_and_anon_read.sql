
ALTER TABLE public.entitlements
ADD CONSTRAINT entitlements_email_product_unique UNIQUE (email, product_id);

CREATE POLICY "Allow anon reads by email"
ON public.entitlements
FOR SELECT
TO public
USING (true);
