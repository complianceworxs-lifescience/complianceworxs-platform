
CREATE TABLE IF NOT EXISTS community_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  description text,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE community_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "config_service_only" ON community_config FOR ALL USING (auth.role() = 'service_role');

INSERT INTO community_config (key, value, description) VALUES
  ('stripe_price_job_standard', 'price_1TIArxBcdOgm3yGB5ZDPhSzm', 'Standard 30-day job listing $299'),
  ('stripe_price_job_featured', 'price_1TIAtpBcdOgm3yGBhgEvaiTJ', 'Featured 30-day job listing $449'),
  ('stripe_product_job_standard', 'prod_UGiIB6cvweI5F8', 'Job Listing — The Authorization Record'),
  ('stripe_product_job_featured', 'prod_UGiKInsBWZcF5N', 'Featured Job Listing — The Authorization Record'),
  ('job_listing_duration_days', '30', 'Days a job listing stays active'),
  ('job_listing_renewal_warning_days', '5', 'Days before expiry to send renewal email')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
