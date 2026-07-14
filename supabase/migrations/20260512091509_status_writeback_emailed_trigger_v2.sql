-- Backfill: mark all historical sends as Emailed
UPDATE warm_outbound_staging
SET enrichment_status = 'Emailed',
    dispatched_at = COALESCE(dispatched_at, NOW())
WHERE id IN (SELECT DISTINCT staging_id FROM gmail_send_log WHERE staging_id IS NOT NULL AND http_status = 200)
  AND enrichment_status NOT IN ('Replied', 'Booked', 'Hot', 'disqualified_in_attio');

CREATE OR REPLACE FUNCTION mark_staging_emailed_on_send()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.staging_id IS NOT NULL AND NEW.http_status = 200 THEN
    UPDATE warm_outbound_staging
    SET enrichment_status = 'Emailed',
        dispatched_at = COALESCE(dispatched_at, NEW.send_date::timestamptz, NOW())
    WHERE id = NEW.staging_id
      AND enrichment_status NOT IN ('Replied', 'Booked', 'Hot', 'disqualified_in_attio');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_staging_emailed ON gmail_send_log;
CREATE TRIGGER trg_mark_staging_emailed
AFTER INSERT ON gmail_send_log
FOR EACH ROW
EXECUTE FUNCTION mark_staging_emailed_on_send();