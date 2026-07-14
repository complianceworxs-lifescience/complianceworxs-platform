-- Phase 1a: Drop dead strategy tables. None of these feed current outbound flow.
-- DM strategy carcass:
DROP TABLE IF EXISTS dm_audience_signals CASCADE;
DROP TABLE IF EXISTS dm_automation_config CASCADE;
DROP TABLE IF EXISTS signals CASCADE;
DROP TABLE IF EXISTS strategy_signals CASCADE;
DROP TABLE IF EXISTS surge_alerts CASCADE;

-- Hunter / Mailerlite / Clay carcass:
DROP TABLE IF EXISTS mailerlite_field_map CASCADE;
DROP TABLE IF EXISTS mailerlite_group_map CASCADE;
DROP TABLE IF EXISTS mailerlite_sync_events CASCADE;
DROP TABLE IF EXISTS gmail_enrichment_queue CASCADE;
DROP TABLE IF EXISTS company_domain_cache CASCADE;
DROP TABLE IF EXISTS linkedin_commenters CASCADE;
DROP TABLE IF EXISTS linkedin_welcome_pending CASCADE;
DROP TABLE IF EXISTS linkedin_connections_snapshot CASCADE;

-- Operator-AI carcass (no actual operator using these):
DROP TABLE IF EXISTS strategy_metrics CASCADE;
DROP TABLE IF EXISTS key_results CASCADE;
DROP TABLE IF EXISTS objectives CASCADE;
DROP TABLE IF EXISTS initiatives CASCADE;
DROP TABLE IF EXISTS operator_commitments CASCADE;
DROP TABLE IF EXISTS operator_questions CASCADE;
DROP TABLE IF EXISTS operator_reviews CASCADE;
DROP TABLE IF EXISTS commitment_calendar_events CASCADE;
DROP TABLE IF EXISTS weekly_tasks CASCADE;
DROP TABLE IF EXISTS weekly_reviews CASCADE;
DROP TABLE IF EXISTS daily_intelligence CASCADE;
DROP TABLE IF EXISTS pending_approvals CASCADE;
DROP TABLE IF EXISTS playbooks CASCADE;
DROP TABLE IF EXISTS playbook_executions CASCADE;
DROP TABLE IF EXISTS playbook_touches CASCADE;
DROP TABLE IF EXISTS playbook_touch_queue CASCADE;
DROP TABLE IF EXISTS optimization_rules CASCADE;
DROP TABLE IF EXISTS optimization_actions_log CASCADE;
DROP TABLE IF EXISTS optimization_baselines CASCADE;
DROP TABLE IF EXISTS action_log CASCADE;
DROP TABLE IF EXISTS action_performance CASCADE;
DROP TABLE IF EXISTS execution_log CASCADE;
DROP TABLE IF EXISTS automation_logs CASCADE;
DROP TABLE IF EXISTS autoclose_log CASCADE;
DROP TABLE IF EXISTS generation_log CASCADE;
DROP TABLE IF EXISTS user_state CASCADE;

-- Exposure-snapshot strategy carcass (the system that emailed Dennis the bot):
DROP TABLE IF EXISTS exposure_snapshots CASCADE;
DROP TABLE IF EXISTS exposure_snapshot_tokens CASCADE;

-- Adverse events strategy carcass:
DROP TABLE IF EXISTS adverse_events_raw CASCADE;
DROP TABLE IF EXISTS adverse_signals CASCADE;
DROP TABLE IF EXISTS adverse_watchlist CASCADE;
DROP TABLE IF EXISTS fda_source_status CASCADE;

-- Decisions / buyer journey / artifacts carcass (none feeding current strategy):
DROP TABLE IF EXISTS decisions CASCADE;
DROP TABLE IF EXISTS buyer_journey CASCADE;
DROP TABLE IF EXISTS artifact_access CASCADE;
DROP TABLE IF EXISTS artifact_product_map CASCADE;

-- Empty zombie tables:
DROP TABLE IF EXISTS partner_referrals_legacy_introductions CASCADE;
DROP TABLE IF EXISTS edge_function_heartbeat CASCADE;
DROP TABLE IF EXISTS content_attribution CASCADE;
DROP TABLE IF EXISTS stripe_token_purchases CASCADE;
DROP TABLE IF EXISTS user_tokens CASCADE;
DROP TABLE IF EXISTS dam_tokens CASCADE;
DROP TABLE IF EXISTS ddrs CASCADE;
DROP TABLE IF EXISTS webhook_events_raw CASCADE;
DROP TABLE IF EXISTS subscribers CASCADE;
DROP TABLE IF EXISTS conversions CASCADE;
DROP TABLE IF EXISTS entitlements CASCADE;
DROP TABLE IF EXISTS csv_lead_staging CASCADE;
DROP TABLE IF EXISTS staging_csv_imports CASCADE;
DROP TABLE IF EXISTS phantombuster_webhook_log CASCADE;
DROP TABLE IF EXISTS outbound_daily_log CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS stripe_events CASCADE;
DROP TABLE IF EXISTS stripe_checkout_sessions CASCADE;
DROP TABLE IF EXISTS stripe_customers CASCADE;
DROP TABLE IF EXISTS integration_sync_queue CASCADE;
DROP TABLE IF EXISTS ab_experiments CASCADE;

-- Community / TIR / partner carcass (deprioritized):
DROP TABLE IF EXISTS community_config CASCADE;
DROP TABLE IF EXISTS community_jobs CASCADE;
DROP TABLE IF EXISTS community_members CASCADE;
DROP TABLE IF EXISTS community_articles CASCADE;
DROP TABLE IF EXISTS community_comments CASCADE;
DROP TABLE IF EXISTS community_job_views CASCADE;
DROP TABLE IF EXISTS community_resource_downloads CASCADE;
DROP TABLE IF EXISTS community_job_applications CASCADE;
DROP TABLE IF EXISTS partner_referrals CASCADE;
DROP TABLE IF EXISTS partners CASCADE;
DROP TABLE IF EXISTS partner_applications CASCADE;
DROP TABLE IF EXISTS partner_commissions CASCADE;
DROP TABLE IF EXISTS vendor_applications CASCADE;
DROP TABLE IF EXISTS customer_lifecycle CASCADE;

-- Other dead-ends:
DROP TABLE IF EXISTS content_pipeline CASCADE;
DROP TABLE IF EXISTS outbound_target_cohort CASCADE;
DROP TABLE IF EXISTS outbound_pace_log CASCADE;
DROP TABLE IF EXISTS lead_outreach_log CASCADE;
DROP TABLE IF EXISTS outreach_touches CASCADE;
DROP TABLE IF EXISTS leads CASCADE;
DROP TABLE IF EXISTS lead_intents CASCADE;       -- duplicates contacts
DROP TABLE IF EXISTS lead_sources CASCADE;       -- never used
DROP TABLE IF EXISTS contact_events CASCADE;     -- duplicates events
DROP TABLE IF EXISTS phantombuster_lead_imports CASCADE;  -- old import format
DROP TABLE IF EXISTS sessions CASCADE;           -- not referenced
DROP TABLE IF EXISTS system_flags CASCADE;
DROP TABLE IF EXISTS outreach_queue CASCADE;     -- DM-era
DROP TABLE IF EXISTS irr_sessions CASCADE;       -- IRR product usage
DROP TABLE IF EXISTS generated_ddrs CASCADE;
DROP TABLE IF EXISTS ddr_access_tokens CASCADE;