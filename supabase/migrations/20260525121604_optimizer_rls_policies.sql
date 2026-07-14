-- Grant service role full access to all three optimizer tables
ALTER TABLE optimizer_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE optimizer_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE optimizer_funnel_snapshots ENABLE ROW LEVEL SECURITY;

-- Full access for service role (edge functions run as service role)
CREATE POLICY "service_role_all_optimizer_config" ON optimizer_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_optimizer_decisions" ON optimizer_decisions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_optimizer_funnel_snapshots" ON optimizer_funnel_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);