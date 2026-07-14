
-- Auto-evaluate readiness on every new row from PhantomBuster.
-- Skips rows that already have a readiness_status (idempotent).
CREATE OR REPLACE FUNCTION trg_auto_evaluate_readiness()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.readiness_status IS NULL AND NEW.archived_at IS NULL THEN
    PERFORM evaluate_lead_readiness(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS warm_outbound_auto_readiness ON warm_outbound_staging;

CREATE TRIGGER warm_outbound_auto_readiness
  AFTER INSERT ON warm_outbound_staging
  FOR EACH ROW
  EXECUTE FUNCTION trg_auto_evaluate_readiness();
