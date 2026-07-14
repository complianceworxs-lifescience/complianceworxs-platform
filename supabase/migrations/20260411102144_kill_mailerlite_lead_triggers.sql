
-- Drop all three MailerLite-bound triggers on leads
DROP TRIGGER IF EXISTS sync_to_mailerlite ON leads;
DROP TRIGGER IF EXISTS tr_prepare_mailerlite_payload ON leads;
DROP TRIGGER IF EXISTS tr_sync_lead_to_mailerlite ON leads;

-- Drop the underlying functions that contained the hardcoded JWT
DROP FUNCTION IF EXISTS autonomous_mailerlite_sync();
DROP FUNCTION IF EXISTS format_lead_for_mailerlite(text, text, text, text);
