
CREATE TABLE IF NOT EXISTS artifact_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  access_granted BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_artifact_access_email ON artifact_access(email);
CREATE INDEX idx_artifact_access_artifact_id ON artifact_access(artifact_id);
CREATE INDEX idx_artifact_access_email_artifact ON artifact_access(email, artifact_id);
CREATE INDEX idx_artifact_access_stripe_session ON artifact_access(stripe_session_id);

-- Map Stripe product IDs to artifact IDs
CREATE TABLE IF NOT EXISTS artifact_product_map (
  stripe_product_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  PRIMARY KEY (stripe_product_id, artifact_id)
);

-- Insert product-to-artifact mappings
INSERT INTO artifact_product_map (stripe_product_id, artifact_id) VALUES
  -- Individual case files
  ('prod_UDl5rawqqkcoLG', 'batch-release'),
  ('prod_UDlDymuyEcB4tV', 'deviation-root-cause'),
  ('prod_UDlCIZKMtosAOc', 'oos-investigation'),
  ('prod_UFa2jdisk1Sk5q', 'deviation-root-cause'),
  ('prod_UDlFRF9XOAUXgq', 'capa-effectiveness'),
  ('prod_UDlEcesLX6E6NZ', 'change-control'),
  ('prod_UDlHwW6dBhgF5b', 'data-integrity'),
  ('prod_UDlIQIcOLAYzoO', 'supplier-qualification'),
  ('prod_UDlJUHEjSiEOfj', 'stability-oot'),
  ('prod_UDlK0dI5V3Rbyc', 'complaint-investigation'),
  ('prod_UDlAWCdvHll92X', 'process-validation'),
  -- Decision Authority Matrix
  ('prod_UH94YPaUqwwLNe', 'decision-authority-matrix'),
  -- 3-file bundle (Deviation, CAPA, Batch Release)
  ('prod_UH20dye2FJiptP', 'deviation-root-cause'),
  ('prod_UH20dye2FJiptP', 'capa-effectiveness'),
  ('prod_UH20dye2FJiptP', 'batch-release'),
  -- 10-file complete package
  ('prod_UCEKNoANdqRMbD', 'batch-release'),
  ('prod_UCEKNoANdqRMbD', 'deviation-root-cause'),
  ('prod_UCEKNoANdqRMbD', 'oos-investigation'),
  ('prod_UCEKNoANdqRMbD', 'capa-effectiveness'),
  ('prod_UCEKNoANdqRMbD', 'change-control'),
  ('prod_UCEKNoANdqRMbD', 'data-integrity'),
  ('prod_UCEKNoANdqRMbD', 'supplier-qualification'),
  ('prod_UCEKNoANdqRMbD', 'stability-oot'),
  ('prod_UCEKNoANdqRMbD', 'complaint-investigation'),
  ('prod_UCEKNoANdqRMbD', 'process-validation')
ON CONFLICT DO NOTHING;
