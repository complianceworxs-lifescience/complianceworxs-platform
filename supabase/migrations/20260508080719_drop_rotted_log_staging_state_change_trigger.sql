-- This trigger and function are pre-truth-engine relics. They reference:
-- - outbound_events table (dropped in cleanup session)
-- - 5 dead edge functions (hunter-linkedin-enrich, warm-outbound-attio-pusher, lead-fit-scorer, first-touch-drafter, outbound-sender)
-- The truth engine handles all this via send_today/inbound_log/outbound_log views and triggers.
DROP TRIGGER IF EXISTS warm_outbound_staging_event_log ON warm_outbound_staging;
DROP FUNCTION IF EXISTS log_staging_state_change();