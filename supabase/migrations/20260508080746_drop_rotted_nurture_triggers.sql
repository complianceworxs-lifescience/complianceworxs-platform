-- Pre-truth-engine nurture chain: enroll_in_nurture references outbound_suppressions (dropped).
-- Truth engine handles followups via advance_today view + manual ops.
DROP TRIGGER IF EXISTS trg_warm_outbound_staging_nurture_dm ON warm_outbound_staging;
DROP TRIGGER IF EXISTS trg_warm_outbound_staging_nurture_purchase ON warm_outbound_staging;
DROP FUNCTION IF EXISTS trg_nurture_on_dm_reply();
DROP FUNCTION IF EXISTS trg_nurture_on_purchase();
DROP FUNCTION IF EXISTS enroll_in_nurture(bigint, text, text);