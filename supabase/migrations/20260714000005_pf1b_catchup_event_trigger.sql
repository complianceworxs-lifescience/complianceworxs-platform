-- PF-1B CATCH-UP MIGRATION (out-of-band recovery)
-- These objects existed in production (project balkvbmtummehgbbeqap) but were
-- created outside the migration history (SQL editor/dashboard). Captured here from
-- their live definitions so the migration set fully reproduces production.
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP+CREATE): safe to re-apply.

DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') EXECUTE FUNCTION rls_auto_enable();

