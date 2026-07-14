
ALTER TABLE community_jobs ADD COLUMN IF NOT EXISTS linkedin_promoted boolean DEFAULT false;

INSERT INTO community_config (key, value, description) VALUES
  ('stripe_price_linkedin_promotion', 'price_1TIBO4BcdOgm3yGBwJ4siC0W', 'LinkedIn Promotion add-on $150'),
  ('stripe_product_linkedin_promotion', 'prod_UGipbMNqkGF4aO', 'LinkedIn Promotion — The Authorization Record')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
