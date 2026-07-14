-- Triage patch: keep send_today / advance_today views functional until Attio migration.
-- Backfill outbound_log from gmail_send_log + trigger to keep current.

-- 1) Backfill historical sends
INSERT INTO outbound_log (id, staging_id, attio_record_id, channel, touch_number, sent_at, sent_by, note)
SELECT 
  gen_random_uuid(),
  g.staging_id,
  s.attio_record_id,
  'email' AS channel,
  CASE g.send_kind 
    WHEN 'first_touch' THEN 1
    WHEN 'followup_1' THEN 2
    ELSE 1
  END AS touch_number,
  g.created_at AS sent_at,
  'gmail_backfill' AS sent_by,
  'Backfilled from gmail_send_log: ' || g.send_kind AS note
FROM gmail_send_log g
LEFT JOIN warm_outbound_staging s ON s.id = g.staging_id
WHERE g.staging_id IS NOT NULL;

-- 2) Trigger: keep outbound_log in sync with gmail_send_log going forward
CREATE OR REPLACE FUNCTION sync_gmail_send_to_outbound_log()
RETURNS TRIGGER AS $$
DECLARE
  v_attio_record_id text;
  v_touch_number int;
BEGIN
  IF NEW.staging_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  SELECT attio_record_id INTO v_attio_record_id 
  FROM warm_outbound_staging WHERE id = NEW.staging_id;
  
  v_touch_number := CASE NEW.send_kind
    WHEN 'first_touch' THEN 1
    WHEN 'followup_1' THEN 2
    WHEN 'followup_2' THEN 3
    WHEN 'followup_3' THEN 4
    ELSE COALESCE(NEW.nurture_touch_number, 1)
  END;
  
  INSERT INTO outbound_log (id, staging_id, attio_record_id, channel, touch_number, sent_at, sent_by, note)
  VALUES (
    gen_random_uuid(),
    NEW.staging_id,
    v_attio_record_id,
    'email',
    v_touch_number,
    NEW.created_at,
    'gmail_send_log_trigger',
    'Auto-synced from gmail_send_log: ' || COALESCE(NEW.send_kind, 'unknown')
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_gmail_send_to_outbound_log ON gmail_send_log;
CREATE TRIGGER trg_sync_gmail_send_to_outbound_log
  AFTER INSERT ON gmail_send_log
  FOR EACH ROW
  EXECUTE FUNCTION sync_gmail_send_to_outbound_log();