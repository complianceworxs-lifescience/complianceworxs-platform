-- PF-1B CATCH-UP MIGRATION (out-of-band recovery)
-- These objects existed in production (project balkvbmtummehgbbeqap) but were
-- created outside the migration history (SQL editor/dashboard). Captured here from
-- their live definitions so the migration set fully reproduces production.
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP+CREATE): safe to re-apply.

DROP TRIGGER IF EXISTS trg_posthog_purchase_on_insert ON orders;
CREATE TRIGGER trg_posthog_purchase_on_insert AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION fire_posthog_purchase_event();

DROP TRIGGER IF EXISTS trg_posthog_purchase_on_status_change ON orders;
CREATE TRIGGER trg_posthog_purchase_on_status_change AFTER UPDATE ON public.orders FOR EACH ROW WHEN (((old.order_status IS DISTINCT FROM new.order_status) AND (new.order_status = 'completed'::text))) EXECUTE FUNCTION fire_posthog_purchase_event();

